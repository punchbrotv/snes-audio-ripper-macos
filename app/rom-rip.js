// Rips music and sound effects straight from the ROM, with no game running.
// 1. The driver (the game's sound program) and every data upload are found in the ROM as block streams.
// 2. The SPC700 emulator boots driver + one upload, answers the driver's handshake and sends commands like the game does.
//    It learns which command starts a song, which uploads are songs, where each song loops, and which commands are
//    sound effects - all from the notes the driver plays, before any audio is made.
// 3. The chip state right after the driver accepts a command is handed to the real sound renderer, so each song and
//    effect plays exactly as in the game, at its true speed and pitch.
'use strict';
const crypto = require('crypto');
const { buildSpc } = require('./spc');
const D = require('./driver');
const A = require('./analyse');
const { readProfile } = require('./profiles');
const { decodeBRRAt, playAtPitch } = require('./brr');
const hex = (n, w = 2) => n.toString(16).toUpperCase().padStart(w, '0');
const SEC = 1024000;
const tick = () => new Promise(r => setImmediate(r));

// run the emulator for some seconds without freezing the app
async function runFor(c, seconds) {
  const end = c.cycles + seconds * SEC;
  while (c.cycles < end) { c.run(Math.min(SEC / 4, end - c.cycles)); if (c.stopped || c.pc >= 0xffc0) return false; await tick(); }
  return true;
}
const voices = ev => new Set(ev.map(e => e.voice)).size;
// share of notes whose sample lives inside the upload: songs carry their own instruments, effects mostly use the driver's
function ownSamples(c, ev, up) {
  if (!up || !ev.length) return 0;
  const dir = c.dsp[0x5d] << 8;
  const inside = s => { const p = c.ram[(dir + s * 4) & 0xffff] | c.ram[(dir + s * 4 + 1) & 0xffff] << 8; return up.blocks.some(b => p >= b.dest && p < b.dest + b.len); };
  const cache = new Map(); let n = 0;
  for (const e of ev) { if (!cache.has(e.srcn)) cache.set(e.srcn, inside(e.srcn)); if (cache.get(e.srcn)) n++; }
  return n / ev.length;
}
const isSong = (c, ev, up) => ev.length >= 6 && ownSamples(c, ev, up) >= 0.5;
const pairs = ev => new Set(ev.map(e => e.voice * 256 + e.srcn)).size;

// The bytes of every sample the given notes used, so two sounds that use different samples never look the same
function sampleHash(c, srcns) {
  const h = crypto.createHash('md5'), dir = c.dsp[0x5d] << 8;
  for (const s of [...srcns].sort((a, b) => a - b)) {
    let p = c.ram[(dir + s * 4) & 0xffff] | c.ram[(dir + s * 4 + 1) & 0xffff] << 8;
    for (let n = 0; n < 4000 && p + 9 <= 0x10000; n++, p += 9) { h.update(c.ram.subarray(p, p + 9)); if (c.ram[p] & 1) break; }
  }
  return h.digest('hex');
}
function noteSignature(ev, upto) {
  const h = crypto.createHash('md5');
  for (const e of ev) { if (e.t > upto * SEC) break; h.update(`${e.voice},${e.srcn},${e.pitch >> 4},${Math.round(e.t / 5120)};`); }
  return h.digest('hex');
}

function findDriver(streams, runs) {
  const covered = b => runs.some(r => r.rom < b.rom + b.len && b.rom < r.rom + r.len);
  let best = null;
  for (const st of streams) {
    if (st.end !== 'terminator' || st.entry == null) continue;
    if (!st.blocks.some(b => b.dest <= st.entry && st.entry < b.dest + b.len)) continue;     // its code is where it starts
    const matched = st.blocks.filter(covered).reduce((n, b) => n + b.len, 0);
    if (matched && (!best || matched > best.matched)) best = { st, matched };
  }
  return best && best.st;
}

async function ripFromRom({ rom, runs, analysis, render, api, log }) {
  const drv = findDriver(analysis.streams, runs);
  if (!drv) { log('ROM rip: no sound-driver upload found in the ROM'); return null; }
  const entry = drv.entry, dBlocks = drv.blocks;
  const overlapsDriver = b => dBlocks.some(d => b.dest < d.dest + d.len && d.dest < b.dest + b.len);
  const uploads = analysis.streams.filter(st => st !== drv && st.entry === entry && st.end === 'terminator' && st.blocks.length && st.blocks.every(b => !overlapsDriver(b) && b.len >= 0x100));
  log(`ROM rip: driver at ROM $${hex(drv.start, 6)} (entry $${hex(entry, 4)}), ${uploads.length} data uploads use it`);
  const image = up => [...dBlocks, ...(up ? up.blocks : [])];
  const bootWith = up => D.boot(rom, image(up), entry);

  const profile = readProfile(rom, log);
  const first = bootWith(null);
  if (!first.ok) { log('ROM rip: driver does not start on its own - ' + first.why); return null; }

  // ---- 1. learn the "play song" command on the first upload that plays music ----
  let play = null;
  const tryPlay = async (up, cmd) => {
    const b = bootWith(up); if (!b.ok) return null;
    const e0 = b.c.events.length;
    if (!D.send(b.c, cmd)) return null;
    const t0 = b.c.cycles;
    await runFor(b.c, 10);
    const ev = b.c.events.slice(e0);
    return isSong(b.c, ev, up) && ev.some(e => e.t - t0 > 6 * SEC) ? { score: pairs(ev), ev } : null;
  };
  const bySize = [...uploads].sort((x, y) => y.blocks.reduce((n, b) => n + b.len, 0) - x.blocks.reduce((n, b) => n + b.len, 0));
  for (const up of bySize.slice(0, 6)) {
    const cands = [];
    for (let cmd = 1; cmd < 256 && cands.length < 6; cmd++) for (const p1 of [0, 1, 2]) {
      const b = bootWith(up); if (!b.ok) break;
      const e0 = b.c.events.length;
      if (!D.send(b.c, [cmd, p1, 0, 0])) continue;
      await runFor(b.c, 2);
      const ev = b.c.events.slice(e0);
      if (ev.length >= 3 && ownSamples(b.c, ev, up) >= 0.5) cands.push([cmd, p1, 0, 0]);
      api.progress(0.02, 'LEARNING THE SOUND PROGRAM', `TRYING COMMAND ${hex(cmd)}`);
    }
    let best = null;
    for (const cand of cands) { const r = await tryPlay(up, cand); if (r && (!best || r.score > best.score)) best = { ...r, cmd: cand }; }
    if (best) { play = best.cmd; break; }
  }
  // Notes can play at volume zero: many drivers take the music volume as extra bytes of the play command.
  // Try a grid of values and keep the one that makes the driver write the loudest voice volumes.
  let songUp = null;
  if (play) {
    songUp = bySize.find(u => true);
    let best = { peak: -1, p: play };
    for (const up of bySize.slice(0, 6)) {
      const t = bootWith(up); if (!t.ok) continue;
      t.c.volPeak = 0; if (!D.send(t.c, play)) continue; await runFor(t.c, 3);
      if (t.c.events.length) { songUp = up; break; }
    }
    const tried = [];
    for (const p2 of [play[2], 0x40, 0x80, 0xc0, 0xff]) for (const p3 of [play[3], 0x40, 0x80, 0xc0, 0xff]) {
      const t = bootWith(songUp); if (!t.ok) break;
      const p = [play[0], play[1], p2, p3];
      if (!D.send(t.c, p)) continue;
      t.c.volPeak = 0; await runFor(t.c, 3);
      if (t.c.events.length) tried.push({ peak: t.c.volPeak, p });
    }
    // loud, but with headroom so busy passages don't clip: prefer voice volumes around 40-70 out of 127
    const comfy = tried.filter(x => x.peak >= 40 && x.peak <= 70);
    for (const x of (comfy.length ? comfy : tried)) if (x.peak > best.peak) best = x;
    play = best.p;
    log(`ROM rip: songs start with command ${play.map(v => hex(v)).join(' ')} (loudest voice volume ${best.peak})`);
    if (best.peak <= 0) log('ROM rip: WARNING - the driver plays notes at volume zero with every value tried');
  } else log('ROM rip: no command starts a song in any upload');

  // Sound effects may also need the volumes set first. The same command with "stop" (0) usually sets them without music.
  let pre = null;
  {
    const preCands = [null];
    if (play) preCands.push([play[0], 0, play[2], play[3]], [play[0], 0, 0xff, 0xff]);
    let probeCmd = -1;
    for (let cmd = 0x80; cmd < 256 && probeCmd < 0; cmd++) for (let k = 0; k < 1; k++) {
      const t = bootWith(null); if (!t.ok) break;
      if (!D.send(t.c, [cmd, 0, 0, 0])) continue;
      await runFor(t.c, 0.5); if (t.c.events.length) probeCmd = cmd;
    }
    if (probeCmd < 0) for (let cmd = 1; cmd < 0x80 && probeCmd < 0; cmd++) {
      if (play && cmd === play[0]) continue;
      const t = bootWith(null); if (!t.ok) break;
      if (!D.send(t.c, [cmd, 0, 0, 0])) continue;
      await runFor(t.c, 0.5); if (t.c.events.length) probeCmd = cmd;
    }
    let best = -1;
    if (probeCmd >= 0) for (const p of preCands) {
      const t = bootWith(null); if (!t.ok) break;
      if (p) { const e0 = t.c.events.length; if (!D.send(t.c, p)) continue; await runFor(t.c, 0.3); if (t.c.events.length > e0) continue; }   // must not start music
      t.c.volPeak = 0; if (!D.send(t.c, [probeCmd, 0, 0, 0])) continue; await runFor(t.c, 1);
      if (t.c.volPeak > best) { best = t.c.volPeak; pre = p; }
    }
    log(`ROM rip: sound effects ${pre ? 'need volume set first with command ' + pre.map(v => hex(v)).join(' ') : 'need no set-up'} (loudest voice volume ${best})`);
  }

  // ---- 2. every upload that is a song: study it, find its loop, render it ----
  const songSigs = new Set(), sfxSigs = new Set(), notSongs = [];
  let songs = 0, sfx = 0;
  for (let i = 0; i < uploads.length; i++) {
    const up = uploads[i], tag = `ROM $${hex(up.start, 6)}`;
    api.progress(0.05 + 0.45 * i / uploads.length, 'READING MUSIC FROM ROM', `UPLOAD ${i + 1}/${uploads.length}`);
    if (!play) { notSongs.push(up); continue; }
    const b = bootWith(up);
    if (!b.ok) { log(`${tag}: driver does not start with it - ${b.why}`); continue; }
    const cmdForThis = (profile && profile.songCmds.get(up.start)) || play;
    if (!D.send(b.c, cmdForThis)) { notSongs.push(up); continue; }
    const snap = D.snapshot(b.c), t0 = b.c.cycles, e0 = b.c.events.length;
    b.c.volPeak = 0;
    await runFor(b.c, 10);
    let ev = b.c.events.slice(e0);
    if (!isSong(b.c, ev, up)) {
      // a block that plays just one or two long notes from its own sample: a voice clip or sound played through the music channel
      if (ev.length && ev.length < 6 && ownSamples(b.c, ev, up) >= 0.5 && b.c.volPeak > 0) {
        try {
          const r = await render(buildSpc(snap, { port0: null, seconds: 20 }), 40000);
          const en = A.rms(A.toMono(r.left, r.right), r.rate), end = A.lastLoud(en, 150);
          if (A.peak(en) >= 250 && await api.addSfx(`${tag} (voice/long sound, ${end.toFixed(1)} s)`, r, end)) { sfx++; log(`${tag}: single long sound saved as an effect`); }
        } catch (e) { log(`${tag}: render failed - ${e.message}`); }
      } else if (ev.length) log(`${tag}: not a song (${ev.length} notes in 10 s, ${Math.round(100 * ownSamples(b.c, ev, up))}% use its own samples)`);
      notSongs.push(up); continue;
    }
    if (b.c.volPeak === 0) log(`${tag}: WARNING - notes play at volume zero`);
    await runFor(b.c, 290);                                                     // 5 minutes of notes to find the loop
    ev = b.c.events.slice(e0).map(e => ({ ...e, t: e.t - t0 }));
    const sig = noteSignature(ev, 20) + sampleHash(b.c, new Set(ev.map(e => e.srcn)));
    if (songSigs.has(sig)) { log(`${tag}: same song as one already saved`); continue; }
    songSigs.add(sig);
    const loop = D.findLoop(ev), lastNote = ev.length ? ev[ev.length - 1].t / SEC : 0;
    let len, fade, how;
    if (loop) { const n = loop.period < 75 ? 2 : 1; len = loop.start + n * loop.period + 8; fade = 8; how = `intro ${loop.start.toFixed(1)} s, loop ${loop.period.toFixed(1)} s, ${n} loop${n > 1 ? 's' : ''} + fade`; }
    else if (lastNote < 295) { len = lastNote + 3; fade = 1.5; how = `ends after ${lastNote.toFixed(1)} s`; }
    else { len = 180; fade = 8; how = 'no loop found, 3 minutes + fade'; }
    len = Math.min(len, 600);
    try {
      const r = await render(buildSpc(snap, { port0: null, seconds: Math.ceil(len) + 1 }), 30000 + len * 400);
      await api.addMusic(`${tag} (${how})`, r, len, fade);
      songs++;
    } catch (e) { log(`${tag}: render failed - ${e.message}`); }
  }

  // ---- 3. sound effects: every command, with the driver alone and with each non-song upload loaded ----
  const sets = [null, ...notSongs], bad = new Set();
  const playCmd = play ? play[0] : -1;
  for (let si = 0; si < sets.length; si++) {
    const up = sets[si], tag = up ? `ROM $${hex(up.start, 6)}` : 'driver';
    let found = 0;
    let cmds = [...Array(255)].map((_, i) => i + 1);
    if (up && profile) {
      cmds = profile.setCmds.get(up.start) || [];
      if (!cmds.length) { log(`${tag}: the game never plays this set's special sounds - skipped`); continue; }
    }
    for (const cmd of cmds) {
      if (cmd === playCmd || bad.has(cmd)) continue;
      if (cmd % 8 === 0) api.progress(0.5 + 0.5 * (si + cmd / 256) / sets.length, 'READING SOUND EFFECTS FROM ROM', `SET ${si + 1}/${sets.length}  COMMAND ${hex(cmd)}`);
      const b = bootWith(up); if (!b.ok) break;
      if (pre) { D.send(b.c, pre); b.c.run(SEC / 50); }
      const e0 = b.c.events.length;
      b.c.volPeak = 0;
      if (!D.send(b.c, [cmd, 0, 0, 0])) { if (b.c.pc >= 0xffc0 || b.c.stopped) bad.add(cmd); continue; }
      const snap = D.snapshot(b.c), t0 = b.c.cycles;
      if (!(await runFor(b.c, 0.6))) { bad.add(cmd); continue; }
      if (b.c.events.length === e0) continue;                                  // silent: not a sound effect
      if (b.c.volPeak === 0) { await runFor(b.c, 0.4); if (b.c.volPeak === 0) continue; }   // notes at volume zero
      await runFor(b.c, 7.4);
      const ev = b.c.events.slice(e0).map(e => ({ ...e, t: e.t - t0 }));
      const sig = noteSignature(ev, 3) + sampleHash(b.c, new Set(ev.map(e => e.srcn)));
      if (sfxSigs.has(sig)) continue;
      sfxSigs.add(sig);
      const sustained = ev.some(e => e.t > 6 * SEC);
      try {
        const r = await render(buildSpc(snap, { port0: null, seconds: sustained ? 30 : 8 }), sustained ? 25000 : 10000);
        const m = A.toMono(r.left, r.right), en = A.rms(m, r.rate), end = A.lastLoud(en, 150);
        if (A.peak(en) < 250) continue;
        const label = `${tag} cmd${hex(cmd)}`;
        if (!sustained || end < 28) { if (await api.addSfx(label, r, end)) { sfx++; found++; } continue; }
        // keeps sounding: a looping effect (alarm, engine, buzz) or a jingle/song played by an effect command
        const lp = A.loopInfo(m, r.rate), vr = A.variation(A.fingerprint(m, r.rate));
        if (lp && lp.corr >= 0.97 && lp.period <= 3.5) { if (await api.addSfx(label + ` (loop ${lp.period.toFixed(2)} s)`, r, lp.cutEnd)) { sfx++; found++; } }
        else if (vr < 0.25) { if (await api.addSfx(label + ' (steady sound)', r, 3)) { sfx++; found++; } }
        else if (voices(ev) < 3) {
          // an endless effect built from a few short snippets picked at random (chatter, ambience):
          // keep 15 s of it as the game plays it, plus every snippet on its own at its usual pitch
          { let pk = 1; for (let i = 0; i < r.left.length; i++) pk = Math.max(pk, Math.abs(r.left[i]), Math.abs(r.right[i]));
            const g = Math.min(8, 20000 / pk); if (g > 1.2) for (let i = 0; i < r.left.length; i++) { r.left[i] *= g; r.right[i] *= g; } }   // the game plays it quietly
          if (await api.addSfx(label + ' (random sequence, 15 s)', r, 15)) { sfx++; found++; }
          const dir = b.c.dsp[0x5d] << 8, bySrc = new Map();
          for (const e of ev) { if (!bySrc.has(e.srcn)) bySrc.set(e.srcn, []); bySrc.get(e.srcn).push(e.pitch); }
          let part = 0;
          for (const [srcn, pitches] of [...bySrc].sort((x, y) => x[0] - y[0])) {
            pitches.sort((x, y) => x - y);
            const start = b.c.ram[dir + srcn * 4] | b.c.ram[dir + srcn * 4 + 1] << 8, pcm = decodeBRRAt(b.c.ram, start);
            if (pcm.length < 256) continue;
            const one = playAtPitch(pcm, pitches[pitches.length >> 1]);
            if (await api.addSfx(`${label} (snippet ${++part} of the random sequence)`, one, one.left.length / one.rate)) { sfx++; found++; }
          }
        }
        else if (api.isNewSong(A.fingerprint(m, r.rate))) { await api.addMusic(label, r, 30, 4); songs++; }
      } catch (e) { log(`${label(tag, cmd)}: render failed - ${e.message}`); }
    }
    log(`${tag}: ${found} new sound effects`);
  }
  log(`ROM rip finished: ${songs} songs, ${sfx} sound effects`);
  return { songs, sfx };
}
const label = (tag, cmd) => `${tag} cmd${hex(cmd)}`;
module.exports = { ripFromRom, findDriver };

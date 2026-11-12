// Finds every song and sound effect the game's own sound program can play, by sending it commands and listening.
// Each result is compared with what was already playing, so only what a command ADDS is kept:
//   - nothing added            -> ignored
//   - something that ends      -> sound effect (isolated from any music underneath)
//   - an exact short repeat    -> looping sound effect (one cycle kept)
//   - sustained new music      -> song, kept only if it is not a song we already have
const fs = require('fs');
const path = require('path');
const { parseSnd, buildSpc, aramDiff, md5 } = require('./spc');
const A = require('./analyse');
const { provenance } = require('./provenance');
const blocks = require('./blocks');
const { ripFromRom } = require('./rom-rip');
const OK_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);
const PROBE = 6, MID = 30, FULL = 70, SILENT = 250, QUIET = 150, SAME_SONG = 0.75, MAX_STATES = 8, STEADY = 0.25;
const tick = () => new Promise(r => setImmediate(r));
function resample(a, from, to) {
  const n = Math.floor(a.length * to / from), o = new Int16Array(n);
  for (let i = 0; i < n; i++) { const p = i * from / to, i0 = Math.floor(p), f = p - i0; o[i] = a[i0] * (1 - f) + a[Math.min(i0 + 1, a.length - 1)] * f; }
  return o;
}

async function ripSnapshots(snaps, dir, emit, log, deps = {}, rom = null) {
  const renderMod = deps.render ? null : require('./render'), render = deps.render || renderMod.render, encode = deps.encode || require('./mp3').encode;
  const parsed = [];
  for (const s of snaps) { try { parsed.push({ frame: s.frame, ...parseSnd(s.block) }); } catch (e) { log(`snapshot at frame ${s.frame} skipped: ${e.message}`); } }
  if (!parsed.length) throw new Error('no usable sound-chip snapshot');
  const diffs = parsed.map(p => aramDiff(parsed[0].aram, p.aram)), maxDiff = Math.max(...diffs);
  log(`sound memory vs first snapshot (bytes changed): ${diffs.join(', ')}`);
  emit({ phase: 'note', text: maxDiff < 4096 ? 'SOUND DATA IS LOADED ONCE AT START - ALL SONGS AVAILABLE FROM ONE SNAPSHOT' : 'SOUND DATA CHANGES DURING THE GAME - SCANNING EACH DISTINCT STATE' });
  const chosen = [];
  for (const p of parsed) if (chosen.length < MAX_STATES && !chosen.some(c => aramDiff(c.aram, p.aram) < 2048)) chosen.push(p);
  log(`${chosen.length} distinct sound-memory state(s) to scan`);
  const runs = []; let analysis = null;
  if (rom) {
    chosen.slice(0, 3).forEach((p, i) => { try { runs.push(...provenance(p.aram, rom, log, `state ${i + 1}`).map(r => ({ ...r, state: i }))); } catch (e) { log('provenance failed: ' + e.message); } });
    try { analysis = blocks.analyse(rom, runs, log); } catch (e) { log('block analysis failed: ' + e.message); }
  }
  const kept = [], sfxCmds = new Set(), seen = new Set(), bad = new Set(), deadline = Date.now() + 45 * 60e3;
  let music = 0, sfx = 0, failures = 0, first = true;
  fs.mkdirSync(path.join(dir, 'Music'), { recursive: true }); fs.mkdirSync(path.join(dir, 'SFX'), { recursive: true });

  const save = async (kind, label, r, keepSec, fadeSec) => {
    const n = Math.min(r.left.length, Math.round(keepSec * r.rate));
    let L = r.left.slice(0, n), R = r.right.slice(0, n), rate = r.rate;
    const fade = Math.min(n, Math.round(fadeSec * rate));
    for (let i = 0; i < fade; i++) { const g = i / fade; L[n - 1 - i] *= g; R[n - 1 - i] *= g; }
    if (!OK_RATES.has(rate)) { L = resample(L, rate, 32000); R = resample(R, rate, 32000); rate = 32000; }
    const file = kind === 'Music' ? `Music Track-${++music}.mp3` : `SFX-${++sfx}.mp3`;
    fs.writeFileSync(path.join(dir, kind, file), await encode([L, R], rate, 160));
    log(`saved ${kind}/${file}  [${label}]`);
    emit({ phase: 'track', pct: null, file: kind + '/' + file, secs: n / r.rate, count: music + sfx, total: '?' });
  };
  const saveSfx = async (c, label, d, endSec) => {
    const key = md5(Buffer.from(d.left.buffer, d.left.byteOffset, Math.min(d.left.byteLength, d.rate * 6)));
    if (sfxCmds.has(c) || seen.has(key)) return;
    seen.add(key); sfxCmds.add(c);
    await save('SFX', label, d, Math.min(d.left.length / d.rate, endSec + 0.4), 0.05);
  };
  const isNewSong = fp => !kept.some(k => A.similar(fp, k) >= SAME_SONG);

  const api = {
    deadline, bad,
    isNewSong,
    progress: (f, label, sub) => emit({ phase: 'record', local: f, pct: 0.15 + 0.85 * f, label, sub: `${sub}  -  ${music} SONGS, ${sfx} SFX` }),
    // sound effects from ROM are judged by their audio only (the same effect in two instrument sets is the same file)
    addSfx: async (label, d, endSec) => {
      const key = md5(Buffer.from(d.left.buffer, d.left.byteOffset, Math.min(d.left.byteLength, d.rate * 6)));
      if (seen.has(key)) return false; seen.add(key);
      await save('SFX', label, d, Math.min(d.left.length / d.rate, endSec + 0.4), 0.05); return true;
    },
    addMusic: async (label, r, len, fade) => {
      kept.push(A.fingerprint(A.toMono(r.left, r.right), r.rate));
      await save('Music', label, r, Math.min(len, r.left.length / r.rate), fade);
    }
  };
  // 1. Preferred: read everything straight from the ROM (no game running, every song and effect reachable)
  let romDone = false;
  if (rom && analysis) {
    try {
      const res = await ripFromRom({ rom, runs, analysis, render, api, log });
      romDone = !!res && (res.songs > 0 || res.sfx >= 3);
    } catch (e) { log('ROM rip failed: ' + (e.stack || e.message)); }
  }
  // 2. Fallback for drivers the ROM rip cannot drive: send commands to the captured sound-chip snapshots
  if (!romDone) {
    log('using the snapshot scan');
  // Sound effects are only taken from a state where no music is playing: with music underneath, a command that bends the music
  // (pitch, volume, fades) leaves a difference signal that sounds like the music itself.
  for (const p of chosen) { try { const r = await render(buildSpc(p, { port0: null, seconds: PROBE }), 8000); p.clean = A.peak(A.rms(A.toMono(r.left, r.right), r.rate)) < SILENT; } catch (e) { p.clean = false; } }
  chosen.sort((x, y) => (y.clean ? 1 : 0) - (x.clean ? 1 : 0));
  const haveClean = chosen.some(p => p.clean);
  log('states with no music playing: ' + chosen.filter(p => p.clean).length + ' of ' + chosen.length);

  for (let ci = 0; ci < chosen.length; ci++) {
    const p = chosen[ci];
    const sfxOk = p.clean || !haveClean;
    let B;
    try { B = await render(buildSpc(p, { port0: null, seconds: FULL }), 60000); } catch (e) { log(`state ${ci + 1}: baseline render failed - ${e.message}`); continue; }
    const bEn = A.rms(A.toMono(B.left, B.right), B.rate);
    if (A.peak(bEn) >= SILENT && A.lastLoud(bEn, QUIET) > FULL - 1) {           // music was already playing when this snapshot was taken
      const fp = A.fingerprint(A.toMono(B.left, B.right), B.rate);
      if (isNewSong(fp)) { kept.push(fp); await save('Music', `state ${ci + 1} playing`, B, FULL, 4); }
    }
    const bm = A.slice(B, MID), bFp = p.clean ? null : A.fingerprint(A.toMono(bm.left, bm.right), B.rate);   // what the music sounded like with no command
    for (let c = 0; c < 256; c++) {
      if (Date.now() > deadline) { log('time limit reached, stopping'); break; }
      if (bad.has(c)) continue;
      const label = 'cmd0x' + c.toString(16).toUpperCase().padStart(2, '0');
      try {
        const t0 = Date.now();
        const R6 = await render(buildSpc(p, { port0: c, seconds: PROBE }), 8000);
        if (first) { log(`first render: ${(R6.left.length / R6.rate).toFixed(1)} s of audio at ${R6.rate} Hz in ${Date.now() - t0} ms`); first = false; }
        const d6 = A.diff(R6, A.slice(B, PROBE)), en6 = A.rms(A.toMono(d6.left, d6.right), d6.rate);
        if (A.peak(en6) >= SILENT) {                                                 // the command changed the sound
          const end6 = A.lastLoud(en6, QUIET);
          if (end6 < PROBE - 1) { if (sfxOk) await saveSfx(c, label, d6, end6); }    // it ended by itself: a sound effect (never from under music)
          else {
            const R30 = await render(buildSpc(p, { port0: c, seconds: MID }), 25000);
            const m30r = A.toMono(R30.left, R30.right), e30 = A.rms(m30r, R30.rate);
            const d30 = A.diff(R30, A.slice(B, MID)), m30 = A.toMono(d30.left, d30.right), en30 = A.rms(m30, d30.rate), end30 = A.lastLoud(en30, QUIET);
            if (end30 < MID - 1.5) { if (sfxOk) await saveSfx(c, label, d30, end30); }
            else if (A.peak(e30) < SILENT || A.lastLoud(e30, QUIET) < MID - 1) { /* music was stopped or faded out: nothing new is playing */ }
            else {
              const fp = A.fingerprint(m30r, R30.rate), vr = A.variation(A.fingerprint(m30, d30.rate));   // variation of what the command ADDED
              const lp = A.loopInfo(m30, d30.rate), exact = lp && lp.corr >= 0.97 && lp.period <= 3.5;
              const overlay = !p.clean && bFp && A.alignedSim(fp, bFp) >= 0.6;                          // still the same music, with something on top
              log(`${label}: sustained sound, repeat match ${lp ? lp.corr.toFixed(2) + ' every ' + lp.period.toFixed(2) + ' s' : 'n/a'}, variation ${vr.toFixed(2)}${overlay ? ', same music as before' : ''}`);
              if (exact) { if (sfxOk) await saveSfx(c, label + ' (loop ' + lp.period.toFixed(2) + 's)', d30, lp.cutEnd); }
              else if (vr < STEADY) { if (sfxOk) await saveSfx(c, label + ' (steady sound)', d30, 3); }   // a constant buzz/hum: keep 3 s, not a song
              else if (overlay) { /* the music that was already playing, with an effect on top: not a new song */ }
              else if (isNewSong(fp)) {
                const R70 = await render(buildSpc(p, { port0: c, seconds: FULL }), 45000);
                const e70 = A.lastLoud(A.rms(A.toMono(R70.left, R70.right), R70.rate), QUIET), ends = e70 < FULL - 1;
                kept.push(A.fingerprint(A.toMono(R70.left, R70.right), R70.rate));
                await save('Music', `state ${ci + 1} ${label}`, R70, ends ? e70 + 0.5 : FULL, ends ? 0.3 : 4);
              }
            }
          }
        }
      } catch (e) {
        failures++; bad.add(c); log(`state ${ci + 1}, ${label}: render failed - ${e.message} (command skipped from now on)`);
        if (failures >= 12 && music + sfx === 0) throw new Error('renderer keeps failing: ' + e.message);
      }
      if (c % 32 === 0) log(`state ${ci + 1}/${chosen.length}, command ${c}/255: ${music} songs, ${sfx} sfx so far`);
      emit({ phase: 'record', local: (ci * 256 + c + 1) / (chosen.length * 256), pct: 0.15 + 0.45 * (ci * 256 + c + 1) / (chosen.length * 256), label: 'FINDING SONGS AND SFX', sub: `STATE ${ci + 1}/${chosen.length}  CMD ${c}/255  -  ${music} SONGS, ${sfx} SFX` });
      await tick();
    }
  }
  }
  if (renderMod) renderMod.shutdown();
  log(`done: ${music} songs, ${sfx} sound effects`);
  return { music, sfx, total: music + sfx };
}
module.exports = { ripSnapshots };

// Core engine: join split ROMs -> strip header -> find BRR samples -> decode -> selected export format
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { readInfo } = require('./cover');
const { fetchArt } = require('./art');
const { recordAudio } = require('./record');
const Export = require('./export');
const Names = require('./track-names');
const { makeLog } = require('./log');

const MAX_FILES = 500; // cap so junk matches can't flood the folder
const RATE = 32000; // SNES DSP native rate
const tick = () => new Promise(r => setImmediate(r));

// BRR block = 1 header byte + 8 data bytes (16 samples)
function decodeBRR(rom, start, blocks) {
  const out = new Int16Array(blocks * 16);
  let p1 = 0, p2 = 0, o = 0;
  for (let b = 0; b < blocks; b++) {
    const base = start + b * 9, h = rom[base], range = h >> 4, filter = (h >> 2) & 3;
    for (let i = 0; i < 16; i++) {
      const byte = rom[base + 1 + (i >> 1)];
      let n = i & 1 ? byte & 15 : byte >> 4;
      if (n > 7) n -= 16;
      let s = range <= 12 ? (n << range) >> 1 : n < 0 ? -2048 : 0;
      if (filter === 1) s += p1 + ((-p1) >> 4);
      else if (filter === 2) s += (p1 << 1) + ((-((p1 << 1) + p1)) >> 5) - p2 + (p2 >> 4);
      else if (filter === 3) s += (p1 << 1) + ((-(p1 + (p1 << 2) + (p1 << 3))) >> 6) - p2 + (((p2 << 1) + p2) >> 4);
      s = Math.max(-16384, Math.min(16383, s));
      p2 = p1; p1 = s;
      out[o++] = s * 2;
    }
  }
  return out;
}

// Score how "audio-like" a decoded sample is (lower = smoother). -1 rejects it.
// Random/compressed data is jagged (diff/level ~1.3); real audio is low-passed.
function quality(pcm, blocks) {
  let sum = 0, diff = 0, clip = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i]);
    sum += v; if (v > 32000) clip++;
    if (i) diff += Math.abs(pcm[i] - pcm[i - 1]);
  }
  if (sum / pcm.length < 40 || clip / pcm.length > 0.03) return -1;
  const ratio = diff / sum, limit = blocks < 24 ? 0.5 : blocks < 100 ? 0.7 : 0.95;
  return ratio < limit ? ratio : -1;
}

async function scanBRR(rom, onPct) {
  const found = [], seen = new Set(), n = rom.length;
  let i = 0, nextYield = 0;
  while (i < n - 54) {
    if (i >= nextYield) { nextYield = i + 0x40000; onPct(i / n, found.length); await tick(); }
    const h = rom[i];
    // first block of a sample: filter 0, no end/loop flags, valid range, not silence padding
    if (h === 0 || (h >> 4) > 12 || (h & 15)) { i++; continue; }
    let j = i, blocks = 0, ended = false, loop = false;
    while (j + 9 <= n && blocks < 6000) {
      const hh = rom[j];
      if ((hh >> 4) > 12) break;
      blocks++;
      if (hh & 1) { ended = true; loop = !!(hh & 2); j += 9; break; }
      if (hh & 3) break;
      j += 9;
    }
    // non-looped sounds must be >= ~60 ms (clicks are useless); looped ones are instrument waveforms
    if (ended && (loop ? blocks >= 8 : blocks >= 120)) {
      const pcm = decodeBRR(rom, i, blocks), q = quality(pcm, blocks);
      if (q >= 0) {
        const id = crypto.createHash('md5').update(rom.subarray(i, j)).digest('hex');
        if (!seen.has(id)) { seen.add(id); found.push({ offset: i, pcm, loop, q }); }
        i = j; continue;
      }
    }
    i++;
  }
  return found;
}

// Looped samples are instrument waveforms: play them as a ~1.5 s note that dies away instead of an endless buzz.
function shape(pcm, loop) {
  let out;
  if (loop) {
    const len = Math.round(RATE * 1.5); out = new Int16Array(len);
    for (let i = 0; i < len; i++) { const f = 1 - i / len; out[i] = pcm[i % pcm.length] * f * f; }
  } else out = Int16Array.from(pcm);
  const fade = Math.min(96, out.length >> 2); // 3 ms edges remove clicks
  for (let i = 0; i < fade; i++) { const g = i / fade; out[i] *= g; out[out.length - 1 - i] *= g; }
  return out;
}

// Raw BRR samples carry no pitch info. SFX are usually stored at ~half the DSP rate, so they are encoded at 16 kHz
// (an octave lower than 32 kHz) which is closer to how they sound in-game. Instrument loops stay at 32 kHz.
async function sampleAudio(pcm, loop) {
  const wav = shape(pcm, loop);
  let peak = 1; for (const v of wav) peak = Math.max(peak, Math.abs(v));
  const g = 29000 / peak, buf = new Int16Array(wav.length);
  for (let i = 0; i < wav.length; i++) buf[i] = wav[i] * g;
  return { channels: [buf], rate: loop ? RATE : 16000 };
}

async function ripRom(paths, desktop, emit, cacheDir = path.join(os.tmpdir(), 'snes-audio-ripper'), options = {}) {
  try {
    const selected = Export.format(options.format), ext = Export.extension(selected);
    emit({ phase: 'join', text: 'LOADING ROM...' });
    const input = require('./input').loadInput(paths);
    let rom = input.rom;
    if (rom.length % 1024 === 512) rom = rom.subarray(512); // strip copier header
    const name = input.name.replace(/[<>:"/\\|?*]+/g, '').replace(/^\.+$/, '').trim() || 'SNES_ROM';
    fs.mkdirSync(desktop, {recursive: true});
    let dir = path.join(desktop, name), suffix = 2;
    while (fs.existsSync(dir)) dir = path.join(desktop, `${name} (${suffix++})`);
    fs.mkdirSync(dir);
    fs.mkdirSync(cacheDir, {recursive:true});
    const info = readInfo(rom);
    emit({ phase: 'meta', title: name, map: info.map, size: (rom.length / 1048576).toFixed(1) + ' MB', parts: input.parts, cover: null });
    // box art + logo download runs alongside the rip; it never blocks or breaks extraction
    const artP = fetchArt([name, info.title].filter(Boolean), cacheDir, dir)

      .then(a => { emit({ phase: 'art', box: a.box && a.box.b64 }); return a; })
      .catch(() => null);
    emit({ phase: 'scan', name, parts: input.parts, text: `SCANNING ${name.toUpperCase()}` + (input.parts > 1 ? ` (${input.parts} PARTS JOINED)` : '') });

    // Real music + sound effects: run the game in an emulator core and record it (skipped if the core isn't installed)
    let rec = null;
    const warnings = [];
    const log = makeLog(dir);
    const romSha256 = Names.romHash(rom);
    const titleProfile = Names.load(input.romPath, cacheDir, romSha256, text => { log(text); emit({ phase: 'note', text }); });
    log('ROM ' + name + ', ' + rom.length + ' bytes, resourcesPath ' + process.resourcesPath);
    try { rec = await recordAudio(rom, input.romPath, dir, emit, log, { format: selected, romSha256, titleProfile }); }
    catch (e) {
      warnings.push('Full music extraction failed: ' + e.message);
      log('RECORDING FAILED: ' + (e.stack || e.message));
      emit({ phase: 'note', text: e.message === 'core-missing' ? 'MUSIC RECORDING SKIPPED - EMULATOR CORE MISSING; REBUILD THE MAC APP'
        : e.message === 'koffi-missing' ? 'MUSIC RECORDING SKIPPED - KOFFI MODULE MISSING - RUN NPM INSTALL' : 'MUSIC RECORDING FAILED - ' + String(e.message).toUpperCase() });
    }
    const base = 0, span = 1;
    if (rec?.skipped) warnings.push(`${rec.skipped} discovered tracks could not be exported; see manifest.json.`);
    if (rec?.discovered && !rec.total && rec.discovered.music + rec.discovered.sfx > 0) {
      await artP;
      return { ok: false, dir, error: 'Tracks were discovered but export failed. See manifest.json for each failure.' };
    }
    // when the sound program was ripped properly, the guessy raw-sample scan is not needed
    if (['midi','logic'].includes(selected) && !(rec && rec.total)) { await artP; return { ok: false, dir, error: 'No editable note events recovered. Try WAV or MP3 for audio export.' }; }
    let samples = (rec && rec.total) ? [] : await scanBRR(rom, (p, f) => emit({ phase: 'scan', pct: base + p * 0.5 * span, found: f }));
    if (!samples.length && !(rec && rec.total)) return { ok: false, error: 'No audio found. This ROM may use compressed sample data.' };
    // keep the cleanest MAX_FILES candidates, then number them in ROM order
    samples = samples.filter(x => !x.loop); // instrument loops are not wanted
    if (!samples.length && !(rec && rec.total)) return { ok: false, error: 'No audio found. This ROM may use compressed sample data.' };
    samples.sort((x, y) => x.q - y.q);
    samples = samples.slice(0, MAX_FILES).sort((x, y) => x.offset - y.offset);
    const rawDir = dir;
    if (samples.length) fs.mkdirSync(path.join(rawDir, 'SFX'), { recursive: true });

    let sfx = 0, inst = 0;
    for (let k = 0; k < samples.length; k++) {
      const s = samples[k], sub = s.loop ? 'Instruments' : 'SFX';
      s.loop ? inst++ : sfx++;
      const file = `SFX-${k + 1}.${ext}`;
      const audio = await sampleAudio(s.pcm, s.loop);
      await Export.writeAudio(path.join(rawDir, sub, file), audio.channels, audio.rate, selected, s.loop ? 96 : 64);
      let m = 0; for (let q = 0; q < s.pcm.length; q += 8) m += Math.abs(s.pcm[q]);
      const lvl = Math.min(1, m / (s.pcm.length / 8) / 6000);
      emit({ phase: 'encode', pct: base + span * (0.5 + (0.5 * (k + 1)) / samples.length), file: sub + '/' + file, secs: s.loop ? 1.5 : s.pcm.length / 16000, count: k + 1, total: samples.length, lvl });
      if (k % 4 === 0) await tick();
    }
    await artP;
    return { ok: true, dir, warnings, format: selected, discovered: rec?.discovered, skipped: rec ? rec.skipped || 0 : 0, count: samples.length + (rec ? rec.total : 0), sfx: sfx + (rec ? rec.sfx : 0), inst, music: rec ? rec.music : 0, sounds: 0, name };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { ripRom, scanBRR, shape };

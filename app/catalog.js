'use strict';
// Discovery builds one format-independent list. Encoding cannot stop discovery or change track IDs.
const fs = require('fs'), path = require('path');
const Export = require('./export'), A = require('./analyse'), Names = require('./track-names');
const OK_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);
function resample(a, from, to) {
  const n = Math.floor(a.length * to / from), out = new Int16Array(n);
  for (let i = 0; i < n; i++) { const p = i * from / to, j = Math.floor(p), f = p - j; out[i] = a[j] * (1 - f) + a[Math.min(j + 1, a.length - 1)] * f; }
  return out;
}
class Catalog {
  constructor(dir, emit = () => {}, log = () => {}, options = {}) { this.options = options; this.dir = dir; this.emit = emit; this.log = log; this.tracks = []; this.counts = { Music: 0, SFX: 0 }; }
  add(kind, label, audio, seconds, fade) {
    const id = kind === 'Music' ? `Music Track-${++this.counts.Music}` : `SFX-${++this.counts.SFX}`;
    // Keep small sound states, not entire minutes of PCM in memory. Audio is replayed for export.
    const source = audio.spc ? { spc: audio.spc, baselineSpc: audio.baselineSpc, gain: audio.gain || 1 } : audio;
    const title = Names.titleFor(this.options.titleProfile, kind, label);
    this.tracks.push({ id, kind, label, ...(title ? { title } : {}), seconds: Math.min(seconds, audio.left.length / audio.rate), fade, source });
    this.log(`discovered ${kind}/${id} [${label}]`);
  }
  async export(selected, deps = {}) {
    selected = Export.format(selected);
    const render = deps.render || require('./render').render, encode = deps.encode || require('./mp3').encode;
    const midi = deps.midi || require('./midi').fromAudioState;
    const manifest = { version: 1, format: selected, ...(this.options.romSha256 ? { romSha256: this.options.romSha256 } : {}), discovered: { music: this.counts.Music, sfx: this.counts.SFX }, tracks: this.tracks.map(({ source, fade, ...t }) => ({ ...t, file: `${t.kind}/${Names.stem(t.id, t.title)}.${Export.extension(selected)}`, status: 'pending' })) };
    const persist = () => fs.writeFileSync(path.join(this.dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.mkdirSync(this.dir, { recursive: true }); persist();
    let music = 0, sfx = 0, skipped = 0;
    for (let i = 0; i < this.tracks.length; i++) {
      const t = this.tracks[i], entry = manifest.tracks[i];
      const timingOptions = { timing: Names.timingFor(this.options.titleProfile, t.kind, t.label), inferTiming: t.kind === 'Music' };
      this.emit({ phase: 'record', local: i / this.tracks.length, pct: .8 + .2 * i / this.tracks.length, text: `EXPORTING ${selected.toUpperCase()} FROM THE DISCOVERED TRACK CATALOG`, label: `EXPORTING ${selected.toUpperCase()}`, sub: `${i + 1}/${this.tracks.length} DISCOVERED TRACKS` });
      try {
        let bytes;
        if (selected === 'logic') {
          const write = deps.logic || require('./logic').write;
          entry.project = await write(path.join(this.dir, entry.file), t.source, t.seconds, t.title || t.label, timingOptions);
        } else if (selected === 'midi') {
          const result = await midi(t.source, t.seconds, t.title || t.label, timingOptions);
          if (!result) throw new Error('No recoverable MIDI note events for this sound.');
          bytes = result.bytes;
          entry.timing = result.timing;
        } else {
          let audio = t.source;
          if (audio.spc) {
            const timeout = 30000 + t.seconds * 400;
            let r = await render(audio.spc, timeout);
            if (audio.baselineSpc) r = A.diff(r, await render(audio.baselineSpc, timeout));
            audio = { ...r, gain: audio.gain };
          }
          const n = Math.min(audio.left.length, Math.round(t.seconds * audio.rate));
          let L = audio.left.slice(0, n), R = audio.right.slice(0, n), rate = audio.rate;
          const gain = audio.gain || 1, fade = Math.min(n, Math.round(t.fade * rate));
          if (gain !== 1) for (let j = 0; j < n; j++) { L[j] *= gain; R[j] *= gain; }
          for (let j = 0; j < fade; j++) { L[n - 1 - j] *= j / fade; R[n - 1 - j] *= j / fade; }
          if (selected === 'mp3' && !OK_RATES.has(rate)) { L = resample(L, rate, 32000); R = resample(R, rate, 32000); rate = 32000; }
          bytes = selected === 'wav' ? require('./wav').encodeWav([L, R], rate) : await encode([L, R], rate, 160);
        }
        fs.mkdirSync(path.join(this.dir, t.kind), { recursive: true });
        if (selected !== 'logic') fs.writeFileSync(path.join(this.dir, entry.file), bytes);
        entry.status = 'exported'; t.kind === 'Music' ? music++ : sfx++;
        this.log(`saved ${entry.file} [${t.label}]`);
        this.emit({ phase: 'track', file: entry.file, secs: t.seconds, count: music + sfx, total: this.tracks.length });
      } catch (e) { skipped++; entry.status = 'failed'; entry.error = e.message; this.log(`export failed ${entry.file}: ${e.message}`); }
      persist();
    }
    manifest.exported = { music, sfx, skipped }; persist();
    return { music, sfx, total: music + sfx, skipped, discovered: manifest.discovered };
  }
}
module.exports = { Catalog };

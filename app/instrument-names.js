'use strict';
// Names are optional local metadata, keyed by sound content, never by game or slot.
const crypto = require('crypto');
function fingerprint(sample) {
  const pcm = Buffer.alloc(sample.pcm.length * 2);
  for (let i = 0; i < sample.pcm.length; i++) pcm.writeInt16LE(sample.pcm[i], i * 2);
  return crypto.createHash('sha256').update('pcm16le/32000/mono:')
    .update(`${sample.loop ? 1 : 0}:${sample.loop ? sample.loopStart : 0}:`).update(pcm).digest('hex');
}
function validate(entries) {
  if (!Array.isArray(entries) || entries.length > 4096) throw Error('Invalid instrument names.');
  const seen = new Set();
  return entries.map(e => {
    if (!e || !/^[a-f0-9]{64}$/.test(e.sampleSha256) || typeof e.name !== 'string' || !e.name.trim() ||
        Array.from(e.name).length > 64 || /[\x00-\x1f\x7f]/.test(e.name) ||
        (e.source !== undefined && (typeof e.source !== 'string' || e.source.length > 2048 || /[\x00-\x1f\x7f]/.test(e.source))))
      throw Error('Each instrument needs a sample fingerprint and a short single-line name.');
    if (seen.has(e.sampleSha256)) throw Error('Duplicate instrument sample fingerprint.');
    seen.add(e.sampleSha256);
    return { sampleSha256: e.sampleSha256, name: e.name.trim(), ...(e.source ? { source: e.source } : {}) };
  });
}
function describe(sample, notes, entries = []) {
  const sampleSha256 = fingerprint(sample), match = entries.find(e => e.sampleSha256 === sampleSha256);
  const noiseNotes = notes.filter(n => n.noise).length;
  const name = noiseNotes === notes.length && notes.length ? 'Noise' : match?.name || (sample.loop ? 'Looped Sample' : 'One-shot Sample');
  return { name, sampleSha256, identification: name === 'Noise' ? 'DSP noise flag' : match ? 'local sample-name profile' : 'unidentified sample',
    ...(match?.source ? { source: match.source } : {}), frames: sample.pcm.length, sampleRate: 32000,
    loop: !!sample.loop, loopStart: sample.loopStart, envelope: { mode: sample.adsr1 & 128 ? 'ADSR' : 'GAIN',
      adsr1: sample.adsr1, adsr2: sample.adsr2, gain: sample.gain }, noiseNotes };
}
function nameTracks(tracks, samples, entries = []) {
  entries = validate(entries);
  const used = new Set();
  for (const g of tracks) {
    const info = describe(samples.get(g.notes[0].instrument), g.notes, entries);
    const slots = [...new Set(g.notes.map(n => n.srcn ?? samples.get(n.instrument).srcn))].sort((a,b) => a-b);
    const voice = g.notes[0].voice + 1;
    const base = `${info.name} - V${voice} S${slots.join('/')}`;
    let name = base, variant = 2;
    while (used.has(name)) name = `${base} (${variant++})`;
    used.add(name); g.name = name;
    g.instrument = { ...info, voice, sampleSlots: slots, detune: g.notes[0].detune, noteCount: g.notes.length };
  }
}
function guide(tracks) {
  const lines = ['INSTRUMENT GUIDE', '', 'Names describe the sampled sound, not necessarily its musical role.',
    'V = original sound-chip voice; S = sample slot. Numbered variants keep different envelope/tuning states separate.',
    'Profile names are supplied metadata matched by PCM and loop fingerprint. Unidentified samples are not guessed.',
    'Sample duration is at 32 kHz unity playback, before looping, pitch changes, and envelopes.', ''];
  for (const g of tracks) {
    const i = g.instrument, hex = v => v === undefined ? 'unknown' : v.toString(16).toUpperCase().padStart(2, '0');
    lines.push(g.name, `  Identification: ${i.identification}`, ...(i.source ? [`  Source: ${i.source}`] : []),
      `  ${i.noteCount} notes; ${i.frames} sample frames (${(i.frames / 32).toFixed(2)} ms); ${i.loop ? 'loop at frame ' + i.loopStart : 'one-shot'}`,
      `  Envelope: ${i.envelope.mode}; ADSR1 ${hex(i.envelope.adsr1)}, ADSR2 ${hex(i.envelope.adsr2)}, GAIN ${hex(i.envelope.gain)}`,
      `  Noise notes: ${i.noiseNotes}; Sampler detune: ${i.detune} semitones`, `  Sample fingerprint: ${i.sampleSha256}`, '');
  }
  return lines.join('\n');
}
module.exports = { fingerprint, validate, describe, nameTracks, guide };

function parseWav(buf) {
  let p = 12, fmt = null, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('latin1', p, p + 4), n = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === 'data') { data = buf.subarray(p + 8, Math.min(buf.length, p + 8 + n)); break; }
    p += 8 + n + (n & 1);
  }
  if (!fmt || !data) throw new Error('unreadable WAV from renderer');
  if (fmt.bits !== 16) throw new Error('renderer returned ' + fmt.bits + '-bit audio');
  const frames = Math.floor(data.length / 2 / fmt.ch), L = new Int16Array(frames), R = new Int16Array(frames);
  for (let i = 0; i < frames; i++) { L[i] = data.readInt16LE(i * 2 * fmt.ch); R[i] = fmt.ch > 1 ? data.readInt16LE(i * 2 * fmt.ch + 2) : L[i]; }
  return { rate: fmt.rate, left: L, right: R };
}
module.exports = { parseWav };

// Standard RIFF/WAVE, signed 16-bit little-endian PCM; no lossy re-encoding.
function encodeWav(channels, rate) {
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2 ||
      !Number.isInteger(rate) || rate <= 0 || channels.some(c => !(c instanceof Int16Array) || c.length !== channels[0].length)) {
    throw new Error('WAV requires matching mono or stereo Int16 PCM channels and a sample rate.');
  }
  const size = channels[0].length * channels.length * 2;
  if (size > 0xffffffff - 36) throw new Error('Audio exceeds the WAV size limit.');
  const out = Buffer.alloc(44 + size), ch = channels.length;
  out.write('RIFF'); out.writeUInt32LE(36 + size, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(ch, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * ch * 2, 28);
  out.writeUInt16LE(ch * 2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(size, 40);
  for (let i = 0; i < channels[0].length; i++) for (let c = 0; c < ch; c++) out.writeInt16LE(channels[c][i], 44 + (i * ch + c) * 2);
  return out;
}
module.exports.encodeWav = encodeWav;

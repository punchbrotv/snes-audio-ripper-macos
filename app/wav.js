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

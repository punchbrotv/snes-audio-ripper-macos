// Shared MP3 encoder (lamejs is an ES module, so it is loaded with dynamic import)
let Mp3Encoder;
const tick = () => new Promise(r => setImmediate(r));
async function encode(channels, rate, kbps) {
  if (!Mp3Encoder) { const m = await import('@breezystack/lamejs'); Mp3Encoder = (m.Mp3Encoder ? m : m.default).Mp3Encoder; }
  const n = channels.length, enc = new Mp3Encoder(n, rate, kbps), parts = [];
  for (let k = 0, i = 0; k < channels[0].length; k += 1152, i++) {
    const a = channels[0].subarray(k, k + 1152);
    const b = n > 1 ? enc.encodeBuffer(a, channels[1].subarray(k, k + 1152)) : enc.encodeBuffer(a);
    if (b.length) parts.push(Buffer.from(b));
    if (i % 400 === 399) await tick();
  }
  const f = enc.flush(); if (f.length) parts.push(Buffer.from(f));
  return Buffer.concat(parts);
}
module.exports = { encode };

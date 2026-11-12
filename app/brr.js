// Decodes one SNES BRR sample straight from sound-chip memory (used to save individual voice snippets cleanly)
function decodeBRRAt(ram, start, maxBlocks = 8000) {
  const out = []; let p1 = 0, p2 = 0, p = start;
  for (let b = 0; b < maxBlocks && p + 9 <= ram.length; b++, p += 9) {
    const h = ram[p], range = h >> 4, filter = (h >> 2) & 3;
    for (let i = 0; i < 16; i++) {
      const byte = ram[p + 1 + (i >> 1)];
      let n = i & 1 ? byte & 15 : byte >> 4; if (n > 7) n -= 16;
      let s = range <= 12 ? (n << range) >> 1 : (n < 0 ? -2048 : 0);
      if (filter === 1) s += p1 + ((-p1) >> 4);
      else if (filter === 2) s += (p1 << 1) + ((-((p1 << 1) + p1)) >> 5) - p2 + (p2 >> 4);
      else if (filter === 3) s += (p1 << 1) + ((-(p1 + (p1 << 2) + (p1 << 3))) >> 6) - p2 + (((p2 << 1) + p2) >> 4);
      s = Math.max(-16384, Math.min(16383, s)); p2 = p1; p1 = s; out.push(s * 2);
    }
    if (h & 1) break;
  }
  return Int16Array.from(out);
}
// Play a decoded sample at a DSP pitch value: returns 32 kHz stereo, normalised to a comfortable level
function playAtPitch(pcm, pitch) {
  const rate = 32000, step = pitch / 0x1000, n = Math.floor(pcm.length / step), L = new Int16Array(n);
  let peak = 1; for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  const g = Math.min(4, 24000 / peak);
  for (let i = 0; i < n; i++) { const x = i * step, i0 = Math.floor(x), f = x - i0, a = pcm[i0], b = pcm[Math.min(i0 + 1, pcm.length - 1)]; L[i] = (a + (b - a) * f) * g; }
  const fade = Math.min(n >> 2, 64); for (let i = 0; i < fade; i++) { L[i] *= i / fade; L[n - 1 - i] *= i / fade; }
  return { rate, left: L, right: L.slice() };
}
module.exports = { decodeBRRAt, playAtPitch };

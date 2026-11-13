// Audio analysis helpers used to tell sound effects, songs and repeats apart
const toMono = (L, R) => { const n = L.length, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = (L[i] + R[i]) / 2; return o; };
function rms(x, rate, win = 0.05) {
  const w = Math.round(rate * win), n = Math.floor(x.length / w), o = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < w; j++) { const v = x[i * w + j]; s += v * v; } o[i] = Math.sqrt(s / w); }
  return o;
}
const peak = a => { let m = 0; for (const v of a) if (v > m) m = v; return m; };
const lastLoud = (en, t, win = 0.05) => { for (let i = en.length - 1; i >= 0; i--) if (en[i] > t) return (i + 1) * win; return 0; };
// a - b: isolates what a command added on top of what was already playing
function diff(a, b) {
  const n = Math.min(a.left.length, b.left.length), L = new Int16Array(n), R = new Int16Array(n), c = v => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);
  for (let i = 0; i < n; i++) { L[i] = c(a.left[i] - b.left[i]); R[i] = c(a.right[i] - b.right[i]); }
  return { rate: a.rate, left: L, right: R, spc: a.spc, baselineSpc: b.spc };
}
const slice = (r, sec) => { const n = Math.min(r.left.length, Math.round(sec * r.rate)); return { ...r, left: r.left.subarray(0, n), right: r.right.subarray(0, n) }; };

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const ur = re[i + k], ui = im[i + k], xr = re[i + k + h], xi = im[i + k + h], vr = xr * cr - xi * ci, vi = xr * ci + xi * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + h] = ur - vr; im[i + k + h] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// Fingerprint = how the energy in 12 frequency bands moves over time: one frame every 0.25 s, each averaged over 0.5 s
// so the result does not depend on exactly where a recording starts. Frames start at 1 s.
const EDGES = [100, 200, 300, 450, 650, 900, 1300, 1900, 2800, 4000, 6000, 9000, 12000];
function fingerprint(x, rate) {
  const N = 2048, hop = Math.round(rate * 0.25), span = Math.round(rate * 0.5), SUB = 8;
  const re = new Float32Array(N), im = new Float32Array(N), hann = new Float32Array(N), frames = [];
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const bins = EDGES.map(f => Math.min(N / 2, Math.round(f * N / rate)));
  for (let p = Math.round(rate); p + span + N <= x.length; p += hop) {
    const acc = new Float64Array(12);
    for (let w = 0; w < SUB; w++) {
      const q = p + Math.round(w * span / SUB);
      for (let i = 0; i < N; i++) { re[i] = x[q + i] * hann[i]; im[i] = 0; }
      fft(re, im);
      for (let b = 0; b < 12; b++) { let e = 0; for (let k = bins[b]; k < Math.max(bins[b] + 1, bins[b + 1]); k++) e += re[k] * re[k] + im[k] * im[k]; acc[b] += e; }
    }
    const f = new Float32Array(12);
    for (let b = 0; b < 12; b++) f[b] = Math.log10(1 + acc[b] / (SUB * N));
    frames.push(f);
  }
  return frames;
}
// Slide an excerpt over a longer fingerprint (songs loop, so it wraps) and return the best correlation
function windowSim(a, b) {
  const D = 12, na = a.length, ma = new Float64Array(D);
  for (const f of a) for (let d = 0; d < D; d++) ma[d] += f[d] / na;
  let va = 0; for (const f of a) for (let d = 0; d < D; d++) { const v = f[d] - ma[d]; va += v * v; }
  if (va < 1e-6 || !b.length) return 0;
  let best = -1;
  for (let s = 0; s < b.length; s++) {
    const mb = new Float64Array(D);
    for (let i = 0; i < na; i++) { const f = b[(s + i) % b.length]; for (let d = 0; d < D; d++) mb[d] += f[d] / na; }
    let cov = 0, vb = 0;
    for (let i = 0; i < na; i++) { const f = b[(s + i) % b.length], g = a[i]; for (let d = 0; d < D; d++) { const y = f[d] - mb[d]; cov += (g[d] - ma[d]) * y; vb += y * y; } }
    if (vb > 1e-6) { const c = cov / Math.sqrt(va * vb); if (c > best) best = c; }
  }
  return best;
}
// 1 = the same music. Compares 20-second excerpts of each against the whole of the other, so it works wherever in the song each was recorded.
function similar(a, b) {
  if (!a.length || !b.length) return 0;
  const EX = 80;
  const excerpts = x => { if (x.length <= EX) return [x]; const o = []; for (let s = 0; s + EX <= x.length && o.length < 3; s += 80) o.push(x.slice(s, s + EX)); return o; };
  let best = -1;
  for (const e of excerpts(a)) best = Math.max(best, windowSim(e, b));
  for (const e of excerpts(b)) best = Math.max(best, windowSim(e, a));
  return best;
}
// Is this sound an exact short repeat (alarm, engine, siren)? Returns period and where one clean cycle ends.
function loopInfo(x, rate) {
  const f = Math.max(1, Math.round(rate / 6000)), n = Math.floor(x.length / f), y = new Float32Array(n), r = rate / f;
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < f; j++) s += x[i * f + j]; y[i] = s / f; }
  const pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + y[i] * y[i];
  const E = (a, len) => pre[a + len] - pre[a];
  const W = Math.round(r), t0 = Math.round(r * 6), minL = Math.round(r * 0.15), maxL = Math.round(r * 3.5);
  if (t0 + maxL + W > n || E(t0, W) < 1e-3 * W) return null;
  const corr = (a, b, len) => { let s = 0; for (let i = 0; i < len; i++) s += y[a + i] * y[b + i]; const ea = E(a, len), eb = E(b, len); return ea > 0 && eb > 0 ? s / Math.sqrt(ea * eb) : 0; };
  let best = 0, lag = 0;
  for (let L = minL; L <= maxL; L++) { const c = corr(t0, t0 + L, W); if (c > best) { best = c; lag = L; } }
  if (best < 0.97) return { corr: best, period: lag / r, cutEnd: 0 };
  const Wi = Math.round(r * 0.5), step = Math.max(1, Math.round(r * 0.1));
  let intro = 0; for (let t = 0; t + lag + Wi < n && t <= t0; t += step) if (corr(t, t + lag, Wi) >= 0.97) { intro = t; break; }
  return { corr: best, period: lag / r, cutEnd: (intro + lag) / r };
}
// Average movement of the band energies over time. Music changes a lot; a constant buzz, hum or crackle barely changes.
function variation(frames) {
  if (frames.length < 8) return 1;
  let sum = 0, n = 0;
  for (let b = 0; b < 12; b++) {
    let m = 0; for (const f of frames) m += f[b] / frames.length;
    if (m < 0.8) continue;
    let v = 0; for (const f of frames) v += (f[b] - m) * (f[b] - m);
    sum += Math.sqrt(v / frames.length); n++;
  }
  return n ? sum / n : 0;
}
// Same-position comparison of two fingerprints: is this still the music that was playing before?
function alignedSim(a, b) {
  const n = Math.min(a.length, b.length); if (n < 8) return 0;
  let cov = 0, va = 0, vb = 0;
  for (let d = 0; d < 12; d++) {
    let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i][d] / n; mb += b[i][d] / n; }
    for (let i = 0; i < n; i++) { const x = a[i][d] - ma, y = b[i][d] - mb; cov += x * y; va += x * x; vb += y * y; }
  }
  return va > 1e-6 && vb > 1e-6 ? cov / Math.sqrt(va * vb) : 0;
}
module.exports = { alignedSim, variation, toMono, rms, peak, lastLoud, diff, slice, fingerprint, similar, loopInfo };

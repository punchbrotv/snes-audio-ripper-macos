// Reads the SNES header (game title) and renders a cover PNG from tile graphics found in the ROM.
const zlib = require('zlib');

function readInfo(rom) {
  let best = null;
  for (const [o, map] of [[0x7fc0, 'LoROM'], [0xffc0, 'HiROM'], [0x40ffc0, 'ExHiROM']]) {
    if (o + 32 > rom.length) continue;
    const comp = rom[o + 0x1c] | (rom[o + 0x1d] << 8), sum = rom[o + 0x1e] | (rom[o + 0x1f] << 8);
    let printable = 0;
    for (let i = 0; i < 21; i++) if (rom[o + i] >= 0x20 && rom[o + i] < 0x7f) printable++;
    const score = ((comp ^ sum) === 0xffff ? 100 : 0) + printable;
    if (printable >= 15 && (!best || score > best.score)) best = { score, o, map };
  }
  if (!best) return { title: '', map: '' };
  const title = rom.toString('latin1', best.o, best.o + 21).replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
  return { title, map: best.map };
}

// 4bpp planar tile region score: real graphics have many equal neighbouring pixels, random/compressed data doesn't
function pix(rom, b, r, x) {
  const a = rom[b + r * 2], c = rom[b + r * 2 + 1], d = rom[b + 16 + r * 2], e = rom[b + 17 + r * 2];
  return ((a >> x) & 1) | (((c >> x) & 1) << 1) | (((d >> x) & 1) << 2) | (((e >> x) & 1) << 3);
}
function tileScore(rom, o) {
  let eq = 0, tot = 0, empty = 0;
  const hist = new Uint16Array(16);
  for (let t = 0; t < 128; t++) {
    const b = o + t * 32; let blank = true;
    for (let r = 0; r < 8; r++) {
      let prev = -1;
      for (let x = 7; x >= 0; x--) {
        const p = pix(rom, b, r, x); hist[p]++;
        if (p) blank = false;
        if (prev >= 0) { tot++; if (p === prev) eq++; }
        prev = p;
      }
    }
    if (blank) empty++;
  }
  if (empty > 40) return 0;
  let used = 0; for (const h of hist) if (h > 60) used++;
  return used < 3 ? 0 : (eq / tot) * Math.min(1, used / 6);
}

function findTiles(rom) {
  const c = [];
  for (let o = 0; o + 4096 <= rom.length; o += 0x400) { const s = tileScore(rom, o); if (s >= 0.4) c.push({ o, s }); }
  if (!c.length) return -1;
  c.sort((a, b) => b.s - a.s);
  const top = c.slice(0, 12);
  return top[Math.floor(Math.random() * top.length)].o;
}

// Look for a valid-looking 16-colour BGR555 palette closest to the tiles
function findPalette(rom, near) {
  let best = null;
  for (let i = 0; i + 32 <= rom.length; i += 2) {
    let ok = true, ascii = true;
    for (let k = 0; k < 32; k += 2) { if (rom[i + k + 1] >= 0x80) { ok = false; break; } }
    if (!ok) continue;
    const set = new Set();
    for (let k = 0; k < 32; k++) { const v = rom[i + k]; if (v < 0x20 || v > 0x7e) ascii = false; if (!(k & 1)) set.add(v | (rom[i + k + 1] << 8)); }
    if (ascii || set.size < 8) continue;
    const d = Math.abs(i - near);
    if (!best || d < best.d) best = { i, d };
  }
  const pal = [];
  for (let k = 0; k < 16; k++) {
    if (!best) { const g = Math.round((k / 15) * 255); pal.push([0, g, Math.round(g * 0.4)]); continue; }
    const w = rom[best.i + k * 2] | (rom[best.i + k * 2 + 1] << 8), r = w & 31, g = (w >> 5) & 31, b = (w >> 10) & 31;
    pal.push([(r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2)]);
  }
  return pal;
}

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function encodePNG(w, h, rgba) {
  const stride = w * 4 + 1, raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function makeCover(rom) {
  const o = findTiles(rom);
  if (o < 0) return null;
  const pal = findPalette(rom, o), S = 4, W = 128 * S, H = 64 * S, out = Buffer.alloc(W * H * 4);
  for (let t = 0; t < 128; t++) {
    const tx = (t % 16) * 8, ty = Math.floor(t / 16) * 8;
    for (let r = 0; r < 8; r++) for (let x = 0; x < 8; x++) {
      const c = pal[pix(rom, o + t * 32, r, 7 - x)];
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const p = (((ty + r) * S + sy) * W + (tx + x) * S + sx) * 4;
        out[p] = c[0]; out[p + 1] = c[1]; out[p + 2] = c[2]; out[p + 3] = 255;
      }
    }
  }
  return encodePNG(W, H, out);
}

module.exports = { readInfo, makeCover };

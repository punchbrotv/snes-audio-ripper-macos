// Finds which parts of the sound-chip memory were copied straight from the ROM, and where in the ROM they live.
// Only offsets are logged (no game data) - used to learn how each game stores and uploads its songs.
const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');
function provenance(aram, rom, log, label) {
  const runs = []; let cur = null, used = 0, found = 0;
  for (let page = 0; page < 256; page++) {
    const chunk = aram.subarray(page * 256, page * 256 + 256);
    let nz = 0; for (let i = 0; i < 256; i++) if (chunk[i]) nz++;
    if (nz < 64) { cur = null; continue; }
    used++;
    let off = -1;
    for (const k of [0, 64, 128, 192]) {
      let from = 0;
      for (let tries = 0; tries < 4 && off < 0; tries++) {
        const idx = rom.indexOf(chunk.subarray(k, k + 32), from);
        if (idx < 0) break;
        const base = idx - k; let same = 0;
        if (base >= 0 && base + 256 <= rom.length) for (let i = 0; i < 256; i++) if (rom[base + i] === chunk[i]) same++;
        if (same >= 224) off = base;
        from = idx + 1;
      }
      if (off >= 0) break;
    }
    if (off < 0) { cur = null; continue; }
    found++;
    if (cur && off === cur.rom + cur.len) cur.len += 256; else { cur = { aram: page * 256, rom: off, len: 256 }; runs.push(cur); }
  }
  log(`${label}: ${found} of ${used} filled 256-byte pages of sound memory were found unchanged in the ROM`);
  for (const r of runs.slice(0, 40)) log(`  sound memory $${hex(r.aram, 4)}-$${hex(r.aram + r.len - 1, 4)}  <-  ROM $${hex(r.rom, 6)}  (${r.len} bytes)`);
  if (runs.length > 40) log(`  ... and ${runs.length - 40} more runs`);
  return runs;
}
module.exports = { provenance };

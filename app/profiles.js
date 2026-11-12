// Game profiles: facts read from a game's own main program (not its sound program) that the general method can't infer.
// Each profile is verified against the ROM before use; if anything doesn't match, it's ignored.
'use strict';
const lorom = (bank, addr) => ((bank & 0x7f) << 15) | (addr & 0x7fff);
const hex = (n, w = 6) => n.toString(16).toUpperCase().padStart(w, '0');

// Jurassic Park (Ocean). Main CPU sound code in bank $83:
//   $83:A0B2  upload table. Music entries (8 bytes): 55 bank addr16 cmd p1 p2 p3 = the exact play command the game sends.
//             Special-sample entries (6 bytes):     34 bank addr16 .. ..
//   $83:9A6E  special sound ID -> upload-table offset of the sample set it needs; the game then sends command $80|ID.
function jurassicPark(rom, log) {
  if (rom.length < 0x20000 || !/^JURASSIC PARK/.test(rom.toString('latin1', 0x7fc0, 0x7fd5))) return null;
  const T = lorom(0x83, 0xa0b2), IDS = lorom(0x83, 0x9a6e);
  const at = o => { const e = rom.subarray(T + o, T + o + 8); return { type: e[0], start: lorom(e[1], e[2] | e[3] << 8), bank: e[1], e }; };
  const songCmds = new Map(), setCmds = new Map();
  for (let o = 2; o < 0x32; o += 8) {
    const x = at(o);
    if (x.type !== 0x55 || x.bank < 0x80) return null;
    songCmds.set(x.start, [x.e[4], x.e[5], x.e[6], x.e[7]]);
  }
  const offsetToSet = new Map();
  for (let o = 0x32; o <= 0x70; o += (o === 0x32 ? 8 : 6)) {
    const x = at(o);
    if (x.type !== 0x34 || x.bank < 0x80) return null;
    offsetToSet.set(o, x.start); setCmds.set(x.start, []);
  }
  for (let id = 0; id < 0x36; id++) {
    const v = rom[IDS + 2 * id] | rom[IDS + 2 * id + 1] << 8;
    if (offsetToSet.has(v)) setCmds.get(offsetToSet.get(v)).push(0x80 | id);
  }
  log(`game profile: Jurassic Park - ${songCmds.size} songs with the game's own play commands, special sounds for ${[...setCmds.values()].filter(v => v.length).length} sample sets`);
  for (const [s, c] of setCmds) log(`  sample set ROM $${hex(s)}: the game plays it with command${c.length === 1 ? '' : 's'} ${c.map(v => hex(v, 2)).join(' ') || '(none - unused)'}`);
  return { name: 'Jurassic Park', songCmds, setCmds };
}

function readProfile(rom, log) {
  for (const f of [jurassicPark]) { try { const p = f(rom, log); if (p) return p; } catch (e) { log('profile check failed: ' + e.message); } }
  return null;
}
module.exports = { readProfile };

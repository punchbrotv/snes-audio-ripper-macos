'use strict';
// Discover pointer-table sound banks from ROM upload blocks and observed sound-memory copies.
// Addresses, table sizes, command ports, and command IDs are learned from the supplied data.
const { parseStream } = require('./blocks');
const D = require('./driver');
const A = require('./analyse');
const { buildSpc } = require('./spc');
const crypto = require('crypto');
const SEC = 1024000;
const tick = () => new Promise(r => setImmediate(r));
const overlap = (a, b) => a.dest < b.dest + b.len && b.dest < a.dest + a.len;
const word = (data, at) => data[at] | data[at + 1] << 8;
const hex = n => n.toString(16).toUpperCase();
function mappedBytes(block, runs) {
  return runs.reduce((sum, r) => sum + (block.rom - block.dest === r.rom - r.aram ?
    Math.max(0, Math.min(block.dest + block.len, r.aram + r.len) - Math.max(block.dest, r.aram)) : 0), 0);
}
function pointerTable(rom, block) {
  let end = block.dest + block.len;
  const pointers = [];
  for (let i = 0; i < 128 && block.dest + i * 2 < end; i++) {
    const p = word(rom, block.rom + i * 2);
    if (p < block.dest + 4 || p >= block.dest + block.len) return null;
    pointers.push(p); end = Math.min(end, p);
  }
  return pointers.length >= 2 && block.dest + pointers.length * 2 === end ? pointers : null;
}
function findLayout(rom, runs) {
  const streams = [];
  for (let p = 0; p + 8 < rom.length; p++) {
    const len = word(rom, p), dest = word(rom, p + 2);
    if (!len || dest < 256 || dest + len > 65536 || p + 4 + len > rom.length) continue;
    const s = parseStream(rom, p);
    if (s.end !== 'terminator' || s.entry < 256 || s.entry >= 0xffc0 || !s.blocks.length) continue;
    if (s.blocks.some((b, i) => s.blocks.slice(0, i).some(a => overlap(a, b)))) continue;
    streams.push(s);
  }
  const drivers = streams.filter(s => s.blocks.some(b => s.entry >= b.dest && s.entry < b.dest + b.len && mappedBytes(b, runs) >= 256));
  drivers.sort((a, b) => b.blocks.reduce((n, x) => n + mappedBytes(x, runs), 0) - a.blocks.reduce((n, x) => n + mappedBytes(x, runs), 0));
  const driver = drivers[0]; if (!driver) return null;
  const code = driver.blocks.find(b => driver.entry >= b.dest && driver.entry < b.dest + b.len);
  const related = streams.filter(s => s.entry === driver.entry);
  const common = [...driver.blocks];
  for (const s of related.filter(s => s.blocks.some(b => mappedBytes(b, runs) >= 256)).sort((a, b) => b.blocks.length - a.blocks.length)) {
    const added = s.blocks.filter(b => !common.some(a => a.hdr === b.hdr));
    if (!added.some(b => mappedBytes(b, runs) >= 256) || added.some(b => b.len >= 256 && mappedBytes(b, runs) < 256)) continue;
    if (s.blocks.some(b => common.some(a => a.hdr !== b.hdr && overlap(a, b)))) continue;
    for (const b of s.blocks) if (!common.some(a => a.hdr === b.hdr)) common.push(b);
  }
  const roots = new Set(common.filter(b => b !== code && pointerTable(rom, b)).map(b => b.dest));
  const banks = new Map();
  for (const s of related) for (const b of s.blocks) {
    if (!roots.has(b.dest) || overlap(b, code)) continue;
    const pointers = pointerTable(rom, b);
    if (pointers) banks.set(b.hdr, { block: b, pointers });
  }
  return banks.size ? { entry: driver.entry, common, banks: [...banks.values()].sort((a, b) => a.block.hdr - b.block.hdr) } : null;
}
function bootBank(rom, layout, bank) {
  const blocks = layout.common.filter(b => !overlap(b, bank.block));
  const b = D.boot(rom, [...blocks, bank.block], layout.entry);
  if (!b.ok) throw new Error(b.why);
  b.c.events.length = 0;
  return b.c;
}
function probe(c, port, cmd, seconds = .15) {
  const reads = new Map(), rd = c.rd;
  c.rd = function(a) {
    if (a >= 256 && a !== this.pc) {
      if (!reads.has(this.pc)) reads.set(this.pc, new Set());
      reads.get(this.pc).add(a);
    }
    return rd.call(this, a);
  };
  c.portIn = [0, 0, 0, 0]; c.portIn[port] = cmd;
  c.run(seconds * SEC); c.rd = rd;
  return reads;
}
// Confirm that successive commands actually index successive entries in the candidate table.
function musicPort(rom, layout, bank) {
  for (let port = 0; port < 4; port++) {
    const trials = [1, 2].map(cmd => probe(bootBank(rom, layout, bank), port, cmd));
    for (const [pc, addresses] of trials[0]) {
      if (addresses.has(bank.block.dest) && trials[1].get(pc)?.has(bank.block.dest + 2)) return port;
    }
  }
  return null;
}
function effectTables(boot, excludedPort) {
  const tables = [];
  for (let port = 0; port < 4; port++) {
    if (port === excludedPort) continue;
    const trials = [1, 2, 3].map(cmd => probe(boot(), port, cmd));
    const candidates = [];
    for (const [pc, values] of trials[0]) {
      if (values.size !== 1) continue;
      const addresses = trials.map(m => m.get(pc)?.size === 1 ? [...m.get(pc)][0] : -1);
      if (addresses[1] === addresses[0] + 2 && addresses[2] === addresses[0] + 4) candidates.push(addresses[0]);
    }
    for (const base of candidates) if (candidates.includes(base + 1) && !candidates.includes(base - 1)) tables.push({ port, base });
  }
  const c = boot();
  for (const table of tables) {
    let end = Math.min(65536, ...tables.filter(t => t.base > table.base).map(t => t.base));
    let count = 0;
    while (count < 127 && table.base + count * 2 < end) {
      const p = word(c.ram, table.base + count * 2);
      if (p <= table.base || p >= 0xffc0) break;
      end = Math.min(end, p); count++;
    }
    table.count = count;
  }
  return tables;
}
async function study(c, seconds) {
  const t0 = c.cycles;
  for (let i = 0; i < seconds; i++) {
    c.run(Math.min(1, seconds - i) * SEC);
    if (c.stopped || c.pc >= 0xffc0) break;
    if (i % 4 === 0) await tick();
  }
  return c.events.map(e => ({ ...e, t: e.t - t0 }));
}
async function ripBanks({ rom, runs, render, api, log }) {
  const layout = findLayout(rom, runs); if (!layout) return null;
  const banks = [];
  for (const bank of layout.banks) {
    try { const port = musicPort(rom, layout, bank); if (port !== null) banks.push({ ...bank, port }); }
    catch (e) { log('Bank probe failed: ' + e.message); }
    await tick();
  }
  if (!banks.length) return null;
  log(`Bank discovery: ${banks.length} music banks; command ports and table lengths verified by CPU reads`);
  let songs = 0, sfx = 0;
  for (let bi = 0; bi < banks.length; bi++) {
    const bank = banks[bi], seen = new Set();
    log(`Bank $${hex(bank.block.hdr)}: ${bank.pointers.length} command slots on port ${bank.port}`);
    for (let i = 0; i < bank.pointers.length; i++) {
      const pointer = bank.pointers[i]; if (seen.has(pointer)) continue; seen.add(pointer);
      const label = `bank $${hex(bank.block.hdr)} port ${bank.port} command ${i + 1}`;
      api.progress(.7 * (bi + i / bank.pointers.length) / banks.length, 'DISCOVERING MUSIC BANKS', label.toUpperCase());
      try {
        const c = bootBank(rom, layout, bank), snap = D.snapshot(c), ports = [0, 0, 0, 0]; ports[bank.port] = i + 1;
        c.portIn = ports.slice();
        const events = await study(c, 180); if (!events.length) { log(label + ': no notes'); continue; }
        const loop = D.findLoop(events), last = events[events.length - 1].t / SEC;
        const seconds = loop ? Math.min(300, loop.start + 2 * loop.period + 8) : last < 175 ? Math.max(2, last + 4) : 180;
        const fade = loop || last >= 175 ? 8 : .15;
        const r = await render(buildSpc(snap, { ports, seconds: Math.ceil(seconds) }), 90000);
        if (A.peak(A.rms(A.toMono(r.left, r.right), r.rate)) < 100) { log(label + ': silent render'); continue; }
        await api.addMusic(label, r, seconds, fade); songs++;
      } catch (e) { log(label + ': failed: ' + e.message); }
    }
  }
  if (!songs) return null;
  // Sample banks can change effect timbres too; scan each distinct bank, deduplicating exact audio.
  const seen = new Set();
  for (let bi = 0; bi < banks.length; bi++) {
    const bank = banks[bi], boot = () => bootBank(rom, layout, bank), tables = effectTables(boot, bank.port);
    for (let port = 0; port < 4; port++) {
      if (port === bank.port) continue;
      const table = tables.find(t => t.port === port), count = table?.count || 127;
      for (let cmd = 1; cmd <= count; cmd++) {
        const label = `bank $${hex(bank.block.hdr)} port ${port} command ${cmd}`;
        if (cmd % 8 === 1) api.progress(.7 + .3 * (bi + (port + cmd / count) / 4) / banks.length, 'DISCOVERING SOUND EFFECTS', label.toUpperCase());
        try {
          const c = boot(), snap = D.snapshot(c), ports = [0, 0, 0, 0]; ports[port] = cmd; c.portIn = ports.slice();
          const events = await study(c, 1); if (!events.length) continue;
          const r = await render(buildSpc(snap, { ports, seconds: 12 }), 20000);
          const en = A.rms(A.toMono(r.left, r.right), r.rate); if (A.peak(en) < 100) continue;
          const sig = crypto.createHash('sha256').update(Buffer.from(r.left.buffer, r.left.byteOffset, r.left.byteLength)).update(Buffer.from(r.right.buffer, r.right.byteOffset, r.right.byteLength)).digest('hex');
          if (seen.has(sig)) continue; seen.add(sig);
          const end = Math.min(12, A.lastLoud(en, 60) + .25);
          if (await api.addSfx(label, r, end)) sfx++;
        } catch (e) { log(label + ': failed: ' + e.message); }
      }
    }
  }
  return { songs, sfx };
}
module.exports = { findLayout, pointerTable, musicPort, effectTables, ripBanks };

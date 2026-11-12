// Understands how a game uploads sound data from its ROM: a stream of blocks [length][destination][data...]
// ending with a terminator [0][entry address]. Real streams are chains of several such blocks, which chance data almost never forms.
const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');
const u16 = (b, o) => b[o] | (b[o + 1] << 8);

function blockAt(rom, hdr) { const len = u16(rom, hdr), dest = u16(rom, hdr + 2); return { hdr, rom: hdr + 4, len, dest }; }

// Follow a stream from its first header until the terminator (which carries the program's entry address)
function parseStream(rom, start, max = 48) {
  const blocks = []; let o = start, entry = null, end = 'invalid';
  for (let n = 0; n < max; n++) {
    if (o + 4 > rom.length) { end = 'eof'; break; }
    const len = u16(rom, o), dest = u16(rom, o + 2);
    if (len === 0) { entry = dest; end = 'terminator'; o += 4; break; }
    if (dest < 0x100 || dest + len > 0x10000 || o + 4 + len > rom.length) break;
    blocks.push({ hdr: o, rom: o + 4, len, dest }); o += 4 + len;
  }
  return { start, blocks, entry, end, next: o };
}

// Every place where two consecutive elements look like upload blocks aimed at destinations seen in sound memory
function findStreams(rom, dests) {
  const starts = [];
  const valid = o => {
    if (o + 4 > rom.length) return false;
    const len = u16(rom, o), dest = u16(rom, o + 2);
    if (len === 0) return dest >= 0x100 && dest < 0xffc0;                        // terminator + entry address
    return dests.has(dest) && len >= 0x100 && dest + len <= 0x10000 && o + 4 + len <= rom.length;
  };
  for (let o = 0; o + 8 < rom.length; o++) {
    const dest = u16(rom, o + 2);
    if (!dests.has(dest)) continue;
    const len = u16(rom, o);
    if (len < 0x100 || dest + len > 0x10000 || o + 4 + len > rom.length) continue;
    if (valid(o + 4 + len)) starts.push(o);
  }
  const streams = []; let upto = 0;
  for (const s of starts) { if (s < upto) continue; const st = parseStream(rom, s); streams.push(st); upto = st.next; }
  return streams;
}
const describe = st => `${st.blocks.length} blocks [${st.blocks.slice(0, 6).map(b => '$' + hex(b.dest, 4) + '+$' + hex(b.len, 4)).join(' ')}${st.blocks.length > 6 ? ' ...' : ''}]  ${st.end === 'terminator' ? 'entry $' + hex(st.entry, 4) : 'no terminator (' + st.end + ')'}`;

function analyse(rom, runs, log) {
  // join pieces of one upload that the page matcher split (a few changed bytes break a run into several)
  const sorted = [...runs].sort((x, y) => x.aram - y.aram), groups = [];
  for (const r of sorted) {
    const g = groups[groups.length - 1];
    if (g && r.aram <= g.end + 0x100 && Math.abs((r.rom - r.aram) - g.shift) < 0x800) g.end = Math.max(g.end, r.aram + r.len);
    else groups.push({ aram: r.aram, end: r.aram + r.len, shift: r.rom - r.aram });
  }
  const dests = new Set(groups.filter(g => g.end - g.aram >= 4096).map(g => g.aram));
  const streams = findStreams(rom, dests);
  log(`upload streams found in the ROM: ${streams.length} (destinations searched: ${[...dests].map(d => '$' + hex(d, 4)).join(' ')})`);
  for (const st of streams.slice(0, 60)) log(`  ROM $${hex(st.start, 6)}: ${describe(st)}`);
  if (streams.length > 60) log(`  ... and ${streams.length - 60} more`);
  return { streams };
}
module.exports = { analyse, parseStream, blockAt, findStreams, describe };

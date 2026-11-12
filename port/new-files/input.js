'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const MAX = 16 * 1024 * 1024;
const EXT = /\.(sfc|smc|swc|fig|bin)$/i;
function validateSize(n) {
  if (n < 32768 || n > MAX) throw new Error('ROM must be between 32 KB and 16 MB.');
}
function loadInput(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.some(p => typeof p !== 'string')) throw new Error('Choose a SNES ROM or ZIP.');
  if (paths.some(p => /\.zip$/i.test(p))) {
    if (paths.length !== 1) throw new Error('Open one ZIP archive at a time.');
    const archive = path.resolve(paths[0]);
    if (fs.statSync(archive).size > 32 * 1024 * 1024) throw new Error('ZIP archive exceeds 32 MB.');
    const entries = execFileSync('/usr/bin/unzip', ['-Z1', archive], {encoding:'utf8', maxBuffer:1024*1024}).split(/\r?\n/).filter(n => EXT.test(n) && !n.startsWith('__MACOSX/'));
    if (entries.length !== 1) throw new Error('ZIP must contain exactly one SNES ROM. Extract it first if it contains several games.');
    // Stream the selected member, never extract archive paths onto the filesystem.
    if (/[*?\[\]\\]/.test(entries[0])) throw new Error('Unsupported characters in ZIP member name. Extract the ROM first.');
    const rom = execFileSync('/usr/bin/unzip', ['-p', archive, entries[0]], {maxBuffer:MAX+513, timeout:30000});
    validateSize(rom.length);
    return {rom, name:path.basename(entries[0]).replace(EXT, ''), parts:1, romPath:archive};
  }
  const { gatherParts } = require('./parts');
  const files = gatherParts(paths);
  const size = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
  validateSize(size);
  const rom = Buffer.concat(files.map(f => fs.readFileSync(f)));
  return {rom, name:path.basename(files[0]).replace(/\.\d{3}$/,'').replace(EXT,''), parts:files.length, romPath:files[0]};
}
module.exports = {loadInput};

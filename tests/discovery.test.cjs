const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { findLayout, pointerTable, musicPort } = require('../app/bank-rip');
const { Catalog } = require('../app/catalog');
const { makeBot } = require('../app/record');
function fixture(shift = 0) {
  const rom = Buffer.alloc(8192), entry = 0x2000 + shift, bankAt = 0x6000 + shift, sampleAt = 0x9000 + shift;
  function stream(at, blocks) {
    const result = [];
    for (const [dest, data] of blocks) {
      rom.writeUInt16LE(data.length, at); rom.writeUInt16LE(dest, at + 2);
      data.copy(rom, at + 4); result.push({ hdr: at, rom: at + 4, dest, len: data.length }); at += 4 + data.length;
    }
    rom.writeUInt16LE(0, at); rom.writeUInt16LE(entry, at + 2); return result;
  }
  function bank(size, pointers) { const b = Buffer.alloc(size); pointers.forEach((p, i) => b.writeUInt16LE(bankAt + p, i * 2)); return b; }
  const driver = stream(700, [[entry, Buffer.alloc(512, 0x11)], [bankAt, bank(64, [6, 20, 30])]]);
  const samples = stream(3000, [[sampleAt, Buffer.alloc(32, 0x22)], [sampleAt + 256, Buffer.alloc(512, 0x33)]]);
  const alternate = stream(5000, [[bankAt, bank(96, [4, 40])]])[0];
  const runs = [driver[0], samples[1]].map(b => ({ aram: b.dest, rom: b.rom, len: b.len }));
  return { rom, runs, entry, bankAt, sampleAt, alternate, driver, samples };
}
test('discovers small drivers, short upload prefixes and unseen banks at relocated addresses', () => {
  for (const shift of [0, 0x1200]) {
    const f = fixture(shift), layout = findLayout(f.rom, f.runs);
    assert.equal(layout.entry, f.entry);
    assert.deepEqual(layout.banks.map(b => b.pointers.length), [3, 2]);
    assert.ok(layout.common.some(b => b.hdr === f.samples[0].hdr && b.len === 32));
    assert.ok(layout.banks.some(b => b.block.hdr === f.alternate.hdr));
    assert.equal(findLayout(f.rom, []), null);
  }
});
test('pointer-table bounds come from data and reject an out-of-bank pointer', () => {
  const f = fixture(), b = f.alternate;
  assert.deepEqual(pointerTable(f.rom, b), [f.bankAt + 4, f.bankAt + 40]);
  f.rom.writeUInt16LE(0xffff, b.rom + 2); assert.equal(pointerTable(f.rom, b), null);
});
test('learns different music command ports from synthetic CPU table reads', () => {
  for (const port of [1, 3]) {
    const f = fixture(), lo = f.bankAt & 255, hi = f.bankAt >> 8;
    // Poll the selected input port, then load a 16-bit table entry indexed by command - 1.
    const program = [0xe4, 0xf4 + port, 0xf0, 0xfc, 0x9c, 0x1c, 0x5d,
      0xf5, lo, hi, 0xc4, 0x20, 0xf5, lo + 1, hi, 0xc4, 0x21, 0x2f, 0xed];
    Buffer.from(program).copy(f.rom, f.driver[0].rom);
    const layout = findLayout(f.rom, f.runs);
    assert.equal(musicPort(f.rom, layout, layout.banks[0]), port);
  }
});
test('discovery input is repeatable across runs and formats', () => {
  const a = makeBot(), b = makeBot();
  for (let i = 0; i < 15000; i++) assert.equal(a(), b());
});
test('export failures preserve the discovered catalog and stable IDs in all formats', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snes-catalog-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const audio = { rate: 8000, left: new Int16Array(8000).fill(500), right: new Int16Array(8000).fill(-500) };
  const catalogs = [];
  for (const format of ['wav', 'mp3', 'midi', 'logic']) {
    const out = path.join(dir, format), catalog = new Catalog(out);
    catalog.add('Music', 'first', { ...audio, spc: Buffer.from([1]) }, 1, 0);
    catalog.add('Music', 'second', { ...audio, spc: Buffer.from([2]) }, 1, 0);
    const result = await catalog.export(format, {
      render: async () => audio,
      encode: async () => Buffer.from('synthetic encoded audio'),
      midi: async s => s.spc[0] === 1 ? null : { bytes: Buffer.from('synthetic MIDI') },
      logic: async (file,s) => { if(s.spc[0]===1)throw Error('synthetic failure');fs.mkdirSync(file,{recursive:true});return {tracks:1} }
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json')));
    catalogs.push(manifest.tracks.map(({ id, kind, label, seconds }) => ({ id, kind, label, seconds })));
    assert.deepEqual(result.discovered, { music: 2, sfx: 0 });
    if (format === 'midi' || format === 'logic') {
      assert.equal(result.music, 1); assert.equal(result.skipped, 1);
      assert.equal(manifest.tracks[0].status, 'failed');
      assert.ok(fs.existsSync(path.join(out, 'Music/Music Track-2.'+(format==='logic'?'logicx':'mid'))));
    } else { assert.equal(result.music, 2); assert.equal(result.skipped, 0); }
  }
  assert.deepEqual(catalogs[0], catalogs[1]); assert.deepEqual(catalogs[1], catalogs[2]); assert.deepEqual(catalogs[2], catalogs[3]);
});
test('music-only default excludes effects in every format; explicit opt-in restores them', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snes-selection-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const audio = { rate:8000, left:new Int16Array(80).fill(500), right:new Int16Array(80).fill(-500) };
  for (const format of ['wav','mp3','midi','logic']) {
    let musicFiles;
    for (const [mode, options] of [['default',{}],['off',{includeSfx:false}],['on',{includeSfx:true}],['invalid',{includeSfx:'true'}]]) {
      const out = path.join(dir,format,mode), events=[], calls=[];
      const catalog = new Catalog(out, p=>events.push(p), ()=>{}, options);
      catalog.add('Music','song one',audio,.01,0);
      catalog.add('SFX','effect',audio,.01,0);
      catalog.add('Music','song two',audio,.01,0);
      const deps = {
        encode:async ()=>{calls.push('encode');return Buffer.from('audio')},
        midi:async (_s,_seconds,title)=>{calls.push(title);return {bytes:Buffer.from(title)}},
        logic:async (file,_s,_seconds,title)=>{calls.push(title);fs.mkdirSync(file,{recursive:true});fs.writeFileSync(path.join(file,'fixture'),title);return {tracks:1}}
      };
      const result=await catalog.export(format,deps), enabled=mode==='on';
      assert.equal(result.music,2);assert.equal(result.sfx,enabled?1:0);assert.equal(result.skipped,0);
      assert.equal(fs.existsSync(path.join(out,'SFX')),enabled);
      const manifest=JSON.parse(fs.readFileSync(path.join(out,'manifest.json')));
      assert.equal(manifest.includeSfx,enabled);assert.equal(manifest.tracks[1].status,enabled?'exported':'excluded');
      assert.deepEqual(manifest.discovered,{music:2,sfx:1});
      assert.deepEqual(events.filter(p=>p.phase==='track').map(p=>p.count),enabled?[1,2,3]:[1,2]);
      assert.ok(events.filter(p=>p.phase==='track').every(p=>p.total===(enabled?3:2)));
      if(format!=='wav')assert.equal(calls.length,enabled?3:2);
      const files=fs.readdirSync(path.join(out,'Music'));
      if(musicFiles)assert.deepEqual(files,musicFiles);else musicFiles=files;
      for(const file of files){
        const leaf=format==='logic'?path.join(file,'fixture'):file;
        assert.deepEqual(fs.readFileSync(path.join(out,'Music',leaf)),fs.readFileSync(path.join(dir,format,'default','Music',leaf)));
      }
    }
  }
});

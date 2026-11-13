const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const Names = require('../app/track-names'), { Catalog } = require('../app/catalog');
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snes-names-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const hash = Names.romHash(Buffer.alloc(1024));
const profile = { version: 1, romSha256: hash, tracks: [{ kind: 'Music', label: 'bank A command 1', title: 'A New Adventure' }, { kind: 'Music', label: 'bank B command 1', title: 'A New Adventure' }] };
test('matches normalized ROM bytes, ignores mismatched sidecars, and supports imported profiles', t => {
  const dir = temp(t), file = path.join(dir, 'game.tracks.json'), cache = path.join(dir, 'cache'), notes = [];
  assert.equal(Names.romHash(Buffer.alloc(1536)), hash);
  fs.writeFileSync(file, JSON.stringify(profile));
  Names.install(file, cache);
  fs.writeFileSync(file, JSON.stringify({ ...profile, romSha256: 'f'.repeat(64) }));
  assert.deepEqual(Names.load(path.join(dir, 'game.zip'), cache, hash, n => notes.push(n)), profile);
  assert.match(notes[0], /does not match/);
  assert.equal(Names.load(path.join(dir, 'other.sfc'), cache, 'a'.repeat(64)), null);
  fs.writeFileSync(file, '{malformed');
  assert.deepEqual(Names.load(path.join(dir, 'game.zip'), cache, hash), profile);
  fs.writeFileSync(file, ' '.repeat(1024 * 1024 + 1));
  assert.throws(() => Names.read(file), /exceeds/);
});
test('validates profile identities and safely bounds filenames without losing stable IDs', () => {
  assert.throws(() => Names.validate({ ...profile, tracks: [profile.tracks[0], profile.tracks[0]] }), /Duplicate/);
  assert.throws(() => Names.validate({ ...profile, tracks: [{ ...profile.tracks[0], title: 'bad\nname' }] }));
  assert.equal(Names.titleFor(profile, 'SFX', 'bank A command 1'), undefined);
  assert.equal(Names.titleFor(profile, 'Music', 'bank C command 1'), undefined);
  assert.equal(Names.stem('Music Track-1'), 'Music Track-1');
  const filename = Names.stem('Music Track-1', '../../<title>: 💿'.repeat(100));
  assert.ok(!/[<>:"/\\|?*\x00-\x1f]/.test(filename));
  assert.ok(Buffer.byteLength(filename.normalize('NFD')) < 150);
  assert.match(filename, /^Music Track-1 - /);
});
test('names every format consistently, retains unmatched tracks, and sends titles to project writers', async t => {
  const dir = temp(t), audio = { rate: 8000, left: new Int16Array(800), right: new Int16Array(800) }, catalogs = [];
  for (const format of ['wav', 'mp3', 'midi', 'logic']) {
    const out = path.join(dir, format), catalog = new Catalog(out, undefined, undefined, { romSha256: hash, titleProfile: profile });
    for (const label of ['bank A command 1', 'bank B command 1', 'unknown']) catalog.add('Music', label, audio, .1, 0);
    const titles = [];
    const result = await catalog.export(format, {
      encode: async () => Buffer.from('audio'),
      midi: async (_s, _seconds, title) => { titles.push(title); return { bytes: Buffer.from('midi') }; },
      logic: async (file, _s, _seconds, title) => { titles.push(title); fs.mkdirSync(file, { recursive: true }); return { tracks: 1 }; }
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json')));
    assert.equal(manifest.romSha256, hash);
    assert.equal(result.music, 3);
    assert.equal(result.skipped, 0);
    assert.match(manifest.tracks[0].file, /Music Track-1 - A New Adventure\./);
    assert.match(manifest.tracks[1].file, /Music Track-2 - A New Adventure\./);
    assert.match(manifest.tracks[2].file, /Music Track-3\./);
    for (const track of manifest.tracks) assert.ok(fs.existsSync(path.join(out, track.file)));
    if (format === 'logic' || format === 'midi') assert.deepEqual(titles, ['A New Adventure', 'A New Adventure', 'unknown']);
    catalogs.push(manifest.tracks.map(({ id, label, title }) => ({ id, label, title })));
  }
  for (const catalog of catalogs) assert.deepEqual(catalog, catalogs[0]);
});

'use strict';
// Optional user metadata. Audio discovery never depends on titles or game identity.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const MAX_BYTES = 8 * 1024 * 1024;
function romHash(rom) {
  if (rom.length % 1024 === 512) rom = rom.subarray(512);
  return crypto.createHash('sha256').update(rom).digest('hex');
}
function validate(profile) {
  if (!profile || profile.version !== 1 || !/^[a-f0-9]{64}$/.test(profile.romSha256) || !Array.isArray(profile.tracks))
    throw Error('Expected a version 1 track-name profile with romSha256 and tracks.');
  if (profile.tracks.length > 10000) throw Error('Too many track names.');
  const seen = new Set();
  const tracks = profile.tracks.map(t => {
    if (!t || !['Music', 'SFX'].includes(t.kind) || typeof t.label !== 'string' || !t.label.trim() || t.label.length > 512 ||
        typeof t.title !== 'string' || !t.title.trim() || t.title.length > 512 || /[\x00-\x1f\x7f]/.test(t.label + t.title))
      throw Error('Each track needs a kind (Music or SFX), discovery label, and title.');
    const key = JSON.stringify([t.kind, t.label]);
    if (seen.has(key)) throw Error('Duplicate discovery label: ' + t.label);
    seen.add(key);
    return { kind: t.kind, label: t.label, title: t.title.trim(), ...(t.timing ? { timing: require('./timing').validate(t.timing) } : {}) };
  });
  return { version: 1, romSha256: profile.romSha256, tracks };
}
function read(file) {
  if (fs.statSync(file).size > MAX_BYTES) throw Error('Track-name profile exceeds 8 MB.');
  return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
}
function install(file, cacheDir) {
  const profile = read(file), dir = path.join(cacheDir, 'track-names');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, profile.romSha256 + '.json'), JSON.stringify(profile, null, 2) + '\n');
  return profile;
}
function load(inputPath, cacheDir, hash, note = () => {}) {
  const ext = path.extname(inputPath);
  const candidates = [inputPath.slice(0, inputPath.length - ext.length) + '.tracks.json', path.join(cacheDir, 'track-names', hash + '.json')];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const profile = read(file);
      if (profile.romSha256 !== hash) throw Error('ROM fingerprint does not match.');
      note(`Loaded ${profile.tracks.length} track names.`);
      return profile;
    } catch (e) { note(`Ignored track-name profile ${path.basename(file)}: ${e.message}`); }
  }
  return null;
}
function timingFor(profile, kind, label) {
  return profile?.tracks.find(t => t.kind === kind && t.label === label)?.timing;
}
function titleFor(profile, kind, label) {
  return profile?.tracks.find(t => t.kind === kind && t.label === label)?.title;
}
function stem(id, title) {
  if (!title) return id;
  let safe = title.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '-').replace(/\s+/g, ' ').trim();
  // Leave room for the stable ID, extension, and filesystem normalization.
  const chars = Array.from(safe);
  while (Buffer.byteLength(chars.join('').normalize('NFD')) > 120) chars.pop();
  safe = chars.join('').replace(/[. ]+$/, '');
  return safe ? `${id} - ${safe}` : id;
}
module.exports = { romHash, validate, read, install, load, titleFor, timingFor, stem };

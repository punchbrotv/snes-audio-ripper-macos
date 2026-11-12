// Fetches SNES box art + logo from the public libretro thumbnail server (no API key) and caches them locally.
const fs = require('fs');
const path = require('path');
const BASE = 'https://thumbnails.libretro.com/';
const SYS = 'Nintendo - Super Nintendo Entertainment System';
const DIRS = { boxart: 'Named_Boxarts', logo: 'Named_Logos' };

let doFetch = (url) => fetch(url, {signal: AbortSignal.timeout(5000)});
try { const { net } = require('electron'); if (net && net.fetch) doFetch = (url) => net.fetch(url, {signal: AbortSignal.timeout(5000)}); } catch (e) { /* plain node */ }

const ent = s => s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
const unurl = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };

async function getIndex(type, cacheDir) {
  const f = path.join(cacheDir, `index_${type}.json`);
  try { if (Date.now() - fs.statSync(f).mtimeMs < 7 * 864e5) return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { /* refetch */ }
  const res = await doFetch(BASE + encodeURIComponent(SYS) + '/' + DIRS[type] + '/');
  if (!res.ok) throw new Error('index ' + res.status);
  const html = await res.text();
  const names = [...html.matchAll(/href="([^"]+\.png)"/gi)].map(m => unurl(ent(m[1])).split('/').pop());
  if (names.length) fs.writeFileSync(f, JSON.stringify(names));
  return names;
}

// ---- fuzzy matching: ROM names / 21-char header titles vs No-Intro style names ----
const words = s => s.replace(/\.png$/i, '').replace(/[\(\[].*?[\)\]]/g, ' ').toLowerCase()
  .replace(/&/g, ' and ').replace(/'/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(w => w && w !== 'the');
const numKey = s => words(s).filter(w => /^\d+$/.test(w)).sort().join(',');
const sortedKey = s => words(s).sort().join('');
const plainKey = s => words(s).join('');
function dice(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const m = new Map(); for (let i = 0; i < a.length - 1; i++) { const g = a.substr(i, 2); m.set(g, (m.get(g) || 0) + 1); }
  let hit = 0; for (let i = 0; i < b.length - 1; i++) { const g = b.substr(i, 2), c = m.get(g); if (c) { hit++; m.set(g, c - 1); } }
  return (2 * hit) / (a.length + b.length - 2);
}
function regionBonus(n) {
  let b = /\(USA\)/.test(n) ? 0.03 : /\(World\)/.test(n) ? 0.025 : /\(Europe\)/.test(n) ? 0.015 : 0;
  if (/\((Beta|Proto|Demo|Sample|Unl|Pirate|Rev)/i.test(n)) b -= 0.05;
  return b;
}
function findMatch(names, queries) {
  const qs = queries.map(q => ({ s: sortedKey(q), p: plainKey(q), n: numKey(q) })).filter(q => q.s);
  let best = null;
  for (const n of names) {
    const s = sortedKey(n), p = plainKey(n), nums = numKey(n);
    let score = 0;
    for (const q of qs) {
      let v = s === q.s ? 1 : dice(s, q.s);
      if (q.p.length >= 10 && p.startsWith(q.p)) v = Math.max(v, 0.92); // truncated 21-char header titles
      if (q.n !== nums) v *= 0.6; // sequel numbers must agree (World vs World 2)
      score = Math.max(score, v);
    }
    const rank = score + regionBonus(n) - n.length * 1e-5;
    if (score >= 0.82 && (!best || rank > best.rank)) best = { n, rank };
  }
  return best && best.n;
}

async function fetchOne(type, queries, cacheDir, outDir, outName) {
  const hit = findMatch(await getIndex(type, cacheDir), queries);
  if (!hit) return null;
  const dir = path.join(cacheDir, 'art', type); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, hit.replace(/[^\w.-]+/g, '_'));
  let buf;
  if (fs.existsSync(file)) buf = fs.readFileSync(file);
  else {
    const res = await doFetch(BASE + encodeURIComponent(SYS) + '/' + DIRS[type] + '/' + encodeURIComponent(hit));
    if (!res.ok) return null;
    buf = Buffer.from(await res.arrayBuffer()); fs.writeFileSync(file, buf);
  }
  fs.writeFileSync(path.join(outDir, outName), buf);
  return { name: hit, b64: buf.toString('base64') };
}

async function fetchArt(queries, cacheDir, outDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const guard = p => Promise.race([p.catch(() => null), new Promise(r => setTimeout(() => r(null), 20000))]);
  const box = await guard(fetchOne('boxart', queries, cacheDir, outDir, 'boxart.png'));
  return { box };
}

module.exports = { fetchArt, findMatch };

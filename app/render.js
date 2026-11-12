// Plays an .spc file through the sound-chip emulator (spc-converter) in a worker thread.
// Every render has a time limit: a command that hangs the player is killed and skipped instead of freezing the app.
const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');
let worker = null, nextId = 1;
const pending = new Map();

function workerFile() {
  const f = path.join(__dirname, 'render-worker.js'), u = f.replace('app.asar', 'app.asar.unpacked');
  return fs.existsSync(u) ? u : f;
}
function failAll(e) { for (const p of pending.values()) { clearTimeout(p.t); p.rej(e); } pending.clear(); }
function start() {
  const w = new Worker(workerFile());
  worker = w;
  w.on('message', m => {
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id); clearTimeout(p.t);
    if (m.error) p.rej(new Error(m.error)); else p.res({ rate: m.rate, left: m.left, right: m.right });
  });
  w.on('error', e => { if (worker === w) worker = null; failAll(e); });
  w.on('exit', () => { if (worker === w) { worker = null; failAll(new Error('render worker exited')); } });
}
function render(spc, timeoutMs = 30000) {
  if (!worker) start();
  return new Promise((res, rej) => {
    const id = nextId++;
    const t = setTimeout(() => {
      pending.delete(id);
      const w = worker; worker = null; if (w) w.terminate();   // kill the stuck player; the next call starts a fresh one
      rej(new Error('render timed out after ' + timeoutMs / 1000 + ' s'));
    }, timeoutMs);
    pending.set(id, { res, rej, t });
    worker.postMessage({ id, spc });
  });
}
function shutdown() { if (worker) { const w = worker; worker = null; w.terminate(); } }
module.exports = { render, shutdown };

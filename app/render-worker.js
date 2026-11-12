// Runs the sound-chip player in a background thread so the app window never freezes
const { parentPort } = require('worker_threads');
const { parseWav } = require('./wav');
let player = null;
parentPort.on('message', async ({ id, spc }) => {
  try {
    if (!player) { const m = require('spc-converter'); player = await (m.default || m)(); }
    let w = await player.renderToWavBlob(Uint8Array.from(spc));
    if (w && typeof w.arrayBuffer === 'function') w = await w.arrayBuffer();
    const r = parseWav(Buffer.from(w));
    parentPort.postMessage({ id, rate: r.rate, left: r.left, right: r.right }, [r.left.buffer, r.right.buffer]);
  } catch (e) {
    parentPort.postMessage({ id, error: String((e && e.message) || e) });
  }
});

// Writes <rom folder>\Debug\log.txt so a failed run can always be diagnosed
const fs = require('fs');
const path = require('path');
function makeLog(dir) {
  const d = path.join(dir, 'Debug'), f = path.join(d, 'log.txt');
  try { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(f, `SNES Audio Ripper log ${new Date().toISOString()}\n`); } catch (e) { /* ignore */ }
  return msg => { try { fs.appendFileSync(f, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch (e) { /* ignore */ } };
}
module.exports = { makeLog };

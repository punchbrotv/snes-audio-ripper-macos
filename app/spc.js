// Reads the sound-chip memory out of a Snes9x save-state and turns it into a standard .spc file.
// Layout verified on real dumps (Snes9x freeze format 0014): SND block = 64 KB ARAM, then SMP registers (32-bit words), then 128 DSP registers.
const crypto = require('crypto');

function findSnd(buf) {
  let p = buf.indexOf(10) + 1;                       // skip "#!s9xsnp:NNNN\n"
  while (p > 0 && p + 11 <= buf.length && buf[p + 3] === 58) {
    const name = buf.toString('latin1', p, p + 3), n = parseInt(buf.toString('latin1', p + 4, p + 10), 10);
    if (name === 'SND') return { off: p + 11, len: n };
    p += 11 + n;
  }
  return null;
}

function parseSnd(b) {
  if (b.length < 65536 + 0x124) throw new Error('SND block too small');
  const aram = b.subarray(0, 65536), t = b.subarray(65536), w = i => t.readUInt32LE(i * 4);
  const pc = w(3), sp = w(4), a = w(5), x = w(6), y = w(7), fl = [8, 9, 10, 11, 12, 13, 14, 15].map(w); // flags n,v,p,b,h,i,z,c
  if (pc >= 0xffc0 || sp > 255 || a > 255 || x > 255 || y > 255 || fl.some(v => v > 1)) throw new Error('unexpected SMP layout or driver not loaded');
  const psw = fl.reduce((acc, v) => (acc << 1) | v, 0);
  const dsp = Buffer.from(t.subarray(0xa4, 0xa4 + 128));
  let used = 0; for (let i = 0; i < 65536; i += 7) if (aram[i]) used++;
  if (used < 600) throw new Error('sound memory is empty');
  return { aram: Buffer.from(aram), regs: { pc, sp, a, x, y, psw }, dsp };
}

// port0 = the command the game's CPU would be sending the sound program (null = leave as captured)
function buildSpc(s, { port0 = null, ports = null, seconds = 60, title = 'SNES Audio Ripper' } = {}) {
  const o = Buffer.alloc(0x10200), r = s.regs;
  o.write('SNES-SPC700 Sound File Data v0.30', 0, 'latin1'); o[0x21] = 26; o[0x22] = 26; o[0x23] = 26; o[0x24] = 30;
  o.writeUInt16LE(r.pc, 0x25); o[0x27] = r.a; o[0x28] = r.x; o[0x29] = r.y; o[0x2a] = r.psw; o[0x2b] = r.sp;
  o.write(title.slice(0, 32), 0x2e, 'latin1'); o.write('SNES Audio Ripper', 0x6e, 'latin1');
  o.write(String(seconds).padStart(3, '0'), 0xa9, 'latin1'); o.write('00000', 0xac, 'latin1');
  s.aram.copy(o, 0x100);
  const R = 0x100;
  o[R + 0xf0] = 0x0a; o[R + 0xf1] = s.aram[0xf1] & 0x87; o[R + 0xf2] = s.aram[0xf2]; o[R + 0xf3] = 0;
  o[R + 0xf4] = port0 == null ? s.aram[0xf4] : port0; o[R + 0xf5] = o[R + 0xf6] = o[R + 0xf7] = 0;
  if (ports) { if (ports.length !== 4 || ports.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error('Invalid SPC ports'); for(let i=0;i<4;i++) o[R+0xf4+i]=ports[i]; }
  o[R + 0xfd] = o[R + 0xfe] = o[R + 0xff] = 0;
  s.dsp.copy(o, 0x10100);
  o[0x10100 + 0x6c] &= 0x3f;                        // un-mute / un-reset
  o[0x10100 + 0x4c] = 0; o[0x10100 + 0x5c] = 0;     // no pending key-on / key-off
  s.aram.copy(o, 0x101c0, 0xffc0, 0x10000);
  return o;
}

function aramDiff(a, b) { let n = 0; for (let i = 0; i < 65536; i++) if (a[i] !== b[i]) n++; return n; }
const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');

module.exports = { findSnd, parseSnd, buildSpc, aramDiff, md5 };

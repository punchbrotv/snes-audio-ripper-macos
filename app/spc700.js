// Minimal SPC700 (SNES sound CPU) emulator with timers and a DSP register file.
// It does not make audio: it runs a game's sound program and records what it tells the DSP to do
// (which voices are keyed on, with which samples and pitches). Used to work out how a driver starts songs.
'use strict';
const CYC = [
  2,8,4,5,3,4,3,6,2,6,5,4,5,4,6,8, 2,8,4,5,4,5,5,6,5,5,6,5,2,2,4,6,
  2,8,4,5,3,4,3,6,2,6,5,4,5,4,5,4, 2,8,4,5,4,5,5,6,5,5,6,5,2,2,3,8,
  2,8,4,5,3,4,3,6,2,6,4,4,5,4,6,6, 2,8,4,5,4,5,5,6,5,5,4,5,2,2,4,3,
  2,8,4,5,3,4,3,6,2,6,4,4,5,4,5,5, 2,8,4,5,4,5,5,6,5,5,5,5,2,2,3,6,
  2,8,4,5,3,4,3,6,2,6,5,4,5,2,4,5, 2,8,4,5,4,5,5,6,5,5,5,5,2,2,12,5,
  3,8,4,5,3,4,3,6,2,6,4,4,5,2,4,4, 2,8,4,5,4,5,5,6,5,5,5,5,2,2,3,4,
  3,8,4,5,4,5,4,7,2,5,6,4,5,2,4,9, 2,8,4,5,5,6,6,7,4,5,5,5,2,2,6,3,
  2,8,4,5,3,4,3,6,2,4,5,3,4,3,4,3, 2,8,4,5,4,5,5,6,3,4,5,4,2,2,4,3];
const IPL = Buffer.from('CDEFBDE800C61DD0FC8FAAF48FBBF578CCF4D0FB2F19EBF4D0FC7EF4D00BE4F5CBF4D700FCD0F3AB0110EF7EF410EBBAF6DA00BAF4C4F4DD5DD0DB1F0000C0FF', 'hex');

class SPC700 {
  constructor(aram, regs = {}, dsp = null) {
    this.ram = Uint8Array.from(aram);
    this.dsp = dsp ? Uint8Array.from(dsp) : new Uint8Array(128);
    this.pc = regs.pc || 0; this.a = regs.a || 0; this.x = regs.x || 0; this.y = regs.y || 0; this.sp = regs.sp == null ? 0xef : regs.sp;
    this.setPsw(regs.psw || 0);
    this.portIn = [0, 0, 0, 0]; this.portOut = [0, 0, 0, 0];
    this.cycles = 0; this.iplOn = false;
    this.t = [0, 1, 2].map(i => ({ en: false, div: 0, cnt: 0, out: 0, target: 0, rate: i === 2 ? 16 : 128 }));
    this.events = []; this.stopped = false; this.dspAddr = 0; this.volPeak = 0;
    // restore control/timer registers from the image
    const c = this.ram[0xf1]; this.t.forEach((t, i) => { t.en = !!(c >> i & 1); t.target = this.ram[0xfa + i]; });
    this.iplOn = !!(c & 0x80); this.dspAddr = this.ram[0xf2];
  }
  setPsw(p) { this.n = p >> 7 & 1; this.v = p >> 6 & 1; this.p = p >> 5 & 1; this.b = p >> 4 & 1; this.h = p >> 3 & 1; this.i = p >> 2 & 1; this.z = p >> 1 & 1; this.c = p & 1; }
  psw() { return this.n << 7 | this.v << 6 | this.p << 5 | this.b << 4 | this.h << 3 | this.i << 2 | this.z << 1 | this.c; }
  // ---- memory ----
  rd(a) {
    a &= 0xffff;
    if (a >= 0xf0 && a <= 0xff) {
      switch (a) {
        case 0xf2: return this.dspAddr;
        case 0xf3: return this.dspRead(this.dspAddr & 0x7f);
        case 0xf4: case 0xf5: case 0xf6: case 0xf7: return this.portIn[a - 0xf4];
        case 0xfd: case 0xfe: case 0xff: { const t = this.t[a - 0xfd], v = t.out; t.out = 0; return v; }
        case 0xfa: case 0xfb: case 0xfc: case 0xf0: case 0xf1: return 0;
        default: return this.ram[a];
      }
    }
    if (a >= 0xffc0 && this.iplOn) return IPL[a - 0xffc0];
    return this.ram[a];
  }
  wr(a, v) {
    a &= 0xffff; v &= 0xff;
    if (a >= 0xf0 && a <= 0xff) {
      switch (a) {
        case 0xf1:
          for (let i = 0; i < 3; i++) { const on = !!(v >> i & 1); if (on && !this.t[i].en) { this.t[i].cnt = 0; this.t[i].out = 0; } this.t[i].en = on; }
          if (v & 0x10) { this.portIn[0] = this.portIn[1] = 0; }
          if (v & 0x20) { this.portIn[2] = this.portIn[3] = 0; }
          this.iplOn = !!(v & 0x80); break;
        case 0xf2: this.dspAddr = v; break;
        case 0xf3: if (this.dspAddr < 0x80) this.dspWrite(this.dspAddr, v); break;
        case 0xf4: case 0xf5: case 0xf6: case 0xf7: this.portOut[a - 0xf4] = v; break;
        case 0xfa: case 0xfb: case 0xfc: this.t[a - 0xfa].target = v; break;
      }
      this.ram[a] = v; return;
    }
    this.ram[a] = v;
  }
  dspRead(r) { return this.dsp[r]; }
  dspWrite(r, v) {
    if (r === 0x7c) { this.dsp[r] = 0; return; }
    this.dsp[r] = v;
    if (r < 0x80 && (r & 0x0f) < 2) { const m = v > 127 ? 256 - v : v; if (m > this.volPeak) this.volPeak = m; }   // loudest voice volume written
    if (r === 0x4c && v) {
      for (let k = 0; k < 8; k++) if (v >> k & 1) {
        const b = k * 16, srcn = this.dsp[b + 4], pitch = this.dsp[b + 2] | (this.dsp[b + 3] & 0x3f) << 8;
        this.events.push({ t: this.cycles, voice: k, srcn, pitch, vol: [this.dsp[b], this.dsp[b + 1]] });
      }
    }
  }
  tick(n) {
    this.cycles += n;
    for (const t of this.t) {
      if (!t.en) continue;
      t.div += n;
      while (t.div >= t.rate) { t.div -= t.rate; t.cnt = (t.cnt + 1) & 0xff; if (t.cnt === (t.target & 0xff)) { t.cnt = 0; t.out = (t.out + 1) & 15; } }
    }
  }
  dp(o) { return (this.p << 8) | (o & 0xff); }
  rdDp(o) { return this.rd(this.dp(o)); }
  wrDp(o, v) { this.wr(this.dp(o), v); }
  rdW(o) { return this.rdDp(o) | this.rdDp((o + 1) & 0xff) << 8; }
  fetch() { const v = this.rd(this.pc); this.pc = (this.pc + 1) & 0xffff; return v; }
  fetchW() { const l = this.fetch(); return l | this.fetch() << 8; }
  push(v) { this.wr(0x100 | this.sp, v); this.sp = (this.sp - 1) & 0xff; }
  pop() { this.sp = (this.sp + 1) & 0xff; return this.rd(0x100 | this.sp); }
  nz(v) { v &= 0xff; this.n = v >> 7; this.z = v === 0 ? 1 : 0; return v; }
  // ---- ALU ----
  adc(a, b) { const r = a + b + this.c; this.h = ((a & 15) + (b & 15) + this.c) > 15 ? 1 : 0; this.v = (~(a ^ b) & (a ^ r) & 0x80) ? 1 : 0; this.c = r > 0xff ? 1 : 0; return this.nz(r); }
  sbc(a, b) { return this.adc(a, b ^ 0xff); }
  cmp(a, b) { const r = a - b; this.c = r >= 0 ? 1 : 0; this.nz(r); }
  alu(k, a, b) {
    switch (k) { case 0: return this.nz(a | b); case 1: return this.nz(a & b); case 2: return this.nz(a ^ b); case 3: this.cmp(a, b); return a; case 4: return this.adc(a, b); case 5: return this.sbc(a, b); }
  }
  asl(v) { this.c = v >> 7; return this.nz(v << 1); }
  lsr(v) { this.c = v & 1; return this.nz(v >> 1); }
  rol(v) { const c = this.c; this.c = v >> 7; return this.nz(v << 1 | c); }
  ror(v) { const c = this.c; this.c = v & 1; return this.nz(v >> 1 | c << 7); }
  rel(o) { return (this.pc + (o > 127 ? o - 256 : o)) & 0xffff; }
  branch(cond) { const o = this.fetch(); if (cond) { this.pc = this.rel(o); return 2; } return 0; }
  mbit() { const w = this.fetchW(); return { a: w & 0x1fff, b: w >> 13 }; }
  // ---- run ----
  step() {
    if (this.stopped) { this.tick(2); return; }
    const op = this.fetch(); let extra = 0;
    const lo = op & 0x1f, grp = op >> 5;
    // ALU block: rows 0x00..0xBF, columns 4..9 and 0x14..0x19
    if (op < 0xc0 && ((lo >= 4 && lo <= 9) || (lo >= 0x14 && lo <= 0x19))) {
      const k = grp; let addr, src, d;
      switch (lo) {
        case 0x04: this.a = this.alu(k, this.a, this.rdDp(this.fetch())); break;
        case 0x05: this.a = this.alu(k, this.a, this.rd(this.fetchW())); break;
        case 0x06: this.a = this.alu(k, this.a, this.rdDp(this.x)); break;
        case 0x07: addr = this.rdW((this.fetch() + this.x) & 0xff); this.a = this.alu(k, this.a, this.rd(addr)); break;
        case 0x08: this.a = this.alu(k, this.a, this.fetch()); break;
        case 0x09: src = this.rdDp(this.fetch()); d = this.fetch(); { const r = this.alu(k, this.rdDp(d), src); if (k !== 3) this.wrDp(d, r); } break;
        case 0x14: this.a = this.alu(k, this.a, this.rdDp((this.fetch() + this.x) & 0xff)); break;
        case 0x15: this.a = this.alu(k, this.a, this.rd(this.fetchW() + this.x)); break;
        case 0x16: this.a = this.alu(k, this.a, this.rd(this.fetchW() + this.y)); break;
        case 0x17: addr = (this.rdW(this.fetch()) + this.y) & 0xffff; this.a = this.alu(k, this.a, this.rd(addr)); break;
        case 0x18: src = this.fetch(); d = this.fetch(); { const r = this.alu(k, this.rdDp(d), src); if (k !== 3) this.wrDp(d, r); } break;
        case 0x19: src = this.rdDp(this.y); { const r = this.alu(k, this.rdDp(this.x), src); if (k !== 3) this.wrDp(this.x, r); } break;
      }
      this.tick(CYC[op]); return;
    }
    if ((op & 0x0f) === 0x01) { const n = op >> 4; this.push(this.pc >> 8); this.push(this.pc & 0xff); this.pc = this.rd(0xffde - 2 * n) | this.rd(0xffdf - 2 * n) << 8; this.tick(8); return; }
    if ((op & 0x0f) === 0x02) { const d = this.fetch(), bit = op >> 5; let v = this.rdDp(d); v = (op & 0x10) ? v & ~(1 << bit) : v | (1 << bit); this.wrDp(d, v); this.tick(4); return; }
    if ((op & 0x0f) === 0x03) { const d = this.fetch(), bit = op >> 5, v = this.rdDp(d), o = this.fetch(); const set = (v >> bit) & 1; if ((op & 0x10) ? !set : set) { this.pc = this.rel(o); extra = 2; } this.tick(5 + extra); return; }
    let a, v, w, d, m, r;
    switch (op) {
      case 0x00: break;
      case 0x0b: d = this.fetch(); this.wrDp(d, this.asl(this.rdDp(d))); break;
      case 0x0c: a = this.fetchW(); this.wr(a, this.asl(this.rd(a))); break;
      case 0x1b: d = (this.fetch() + this.x) & 0xff; this.wrDp(d, this.asl(this.rdDp(d))); break;
      case 0x1c: this.a = this.asl(this.a); break;
      case 0x2b: d = this.fetch(); this.wrDp(d, this.rol(this.rdDp(d))); break;
      case 0x2c: a = this.fetchW(); this.wr(a, this.rol(this.rd(a))); break;
      case 0x3b: d = (this.fetch() + this.x) & 0xff; this.wrDp(d, this.rol(this.rdDp(d))); break;
      case 0x3c: this.a = this.rol(this.a); break;
      case 0x4b: d = this.fetch(); this.wrDp(d, this.lsr(this.rdDp(d))); break;
      case 0x4c: a = this.fetchW(); this.wr(a, this.lsr(this.rd(a))); break;
      case 0x5b: d = (this.fetch() + this.x) & 0xff; this.wrDp(d, this.lsr(this.rdDp(d))); break;
      case 0x5c: this.a = this.lsr(this.a); break;
      case 0x6b: d = this.fetch(); this.wrDp(d, this.ror(this.rdDp(d))); break;
      case 0x6c: a = this.fetchW(); this.wr(a, this.ror(this.rd(a))); break;
      case 0x7b: d = (this.fetch() + this.x) & 0xff; this.wrDp(d, this.ror(this.rdDp(d))); break;
      case 0x7c: this.a = this.ror(this.a); break;
      case 0x8b: d = this.fetch(); this.wrDp(d, this.nz(this.rdDp(d) - 1)); break;
      case 0x8c: a = this.fetchW(); this.wr(a, this.nz(this.rd(a) - 1)); break;
      case 0x9b: d = (this.fetch() + this.x) & 0xff; this.wrDp(d, this.nz(this.rdDp(d) - 1)); break;
      case 0x9c: this.a = this.nz(this.a - 1); break;
      case 0xab: d = this.fetch(); this.wrDp(d, this.nz(this.rdDp(d) + 1)); break;
      case 0xac: a = this.fetchW(); this.wr(a, this.nz(this.rd(a) + 1)); break;
      case 0xbb: d = (this.fetch() + this.x) & 0xff; this.wrDp(d, this.nz(this.rdDp(d) + 1)); break;
      case 0xbc: this.a = this.nz(this.a + 1); break;
      case 0x1d: this.x = this.nz(this.x - 1); break;
      case 0x3d: this.x = this.nz(this.x + 1); break;
      case 0xdc: this.y = this.nz(this.y - 1); break;
      case 0xfc: this.y = this.nz(this.y + 1); break;
      case 0x10: extra = this.branch(!this.n); break;
      case 0x30: extra = this.branch(this.n); break;
      case 0x50: extra = this.branch(!this.v); break;
      case 0x70: extra = this.branch(this.v); break;
      case 0x90: extra = this.branch(!this.c); break;
      case 0xb0: extra = this.branch(this.c); break;
      case 0xd0: extra = this.branch(!this.z); break;
      case 0xf0: extra = this.branch(this.z); break;
      case 0x2f: this.pc = this.rel(this.fetch()); break;
      case 0x2e: d = this.fetch(); r = this.fetch(); if (this.a !== this.rdDp(d)) { this.pc = this.rel(r); extra = 2; } break;
      case 0xde: d = this.fetch(); r = this.fetch(); if (this.a !== this.rdDp((d + this.x) & 0xff)) { this.pc = this.rel(r); extra = 2; } break;
      case 0x6e: d = this.fetch(); r = this.fetch(); v = (this.rdDp(d) - 1) & 0xff; this.wrDp(d, v); if (v) { this.pc = this.rel(r); extra = 2; } break;
      case 0xfe: r = this.fetch(); this.y = (this.y - 1) & 0xff; if (this.y) { this.pc = this.rel(r); extra = 2; } break;
      case 0x0a: case 0x2a: case 0x4a: case 0x6a: case 0x8a: case 0xaa: case 0xca: case 0xea: {
        m = this.mbit(); const bit = (this.rd(m.a) >> m.b) & 1;
        if (op === 0x0a) this.c |= bit; else if (op === 0x2a) this.c |= bit ^ 1; else if (op === 0x4a) this.c &= bit; else if (op === 0x6a) this.c &= bit ^ 1;
        else if (op === 0x8a) this.c ^= bit; else if (op === 0xaa) this.c = bit;
        else if (op === 0xca) { v = this.rd(m.a); this.wr(m.a, this.c ? v | 1 << m.b : v & ~(1 << m.b)); }
        else { v = this.rd(m.a); this.wr(m.a, v ^ (1 << m.b)); }
        break;
      }
      case 0x0e: a = this.fetchW(); v = this.rd(a); this.nz(this.a - v); this.wr(a, v | this.a); break;
      case 0x4e: a = this.fetchW(); v = this.rd(a); this.nz(this.a - v); this.wr(a, v & ~this.a); break;
      case 0x0d: this.push(this.psw()); break;
      case 0x2d: this.push(this.a); break;
      case 0x4d: this.push(this.x); break;
      case 0x6d: this.push(this.y); break;
      case 0x8e: this.setPsw(this.pop()); break;
      case 0xae: this.a = this.pop(); break;
      case 0xce: this.x = this.pop(); break;
      case 0xee: this.y = this.pop(); break;
      case 0x0f: this.push(this.pc >> 8); this.push(this.pc & 0xff); this.push(this.psw()); this.b = 1; this.i = 0; this.pc = this.rd(0xffde) | this.rd(0xffdf) << 8; break;
      case 0x1f: a = (this.fetchW() + this.x) & 0xffff; this.pc = this.rd(a) | this.rd(a + 1) << 8; break;
      case 0x3f: a = this.fetchW(); this.push(this.pc >> 8); this.push(this.pc & 0xff); this.pc = a; break;
      case 0x4f: v = this.fetch(); this.push(this.pc >> 8); this.push(this.pc & 0xff); this.pc = 0xff00 | v; break;
      case 0x5f: this.pc = this.fetchW(); break;
      case 0x6f: { const l = this.pop(); this.pc = l | this.pop() << 8; break; }
      case 0x7f: { this.setPsw(this.pop()); const l = this.pop(); this.pc = l | this.pop() << 8; break; }
      case 0x1a: d = this.fetch(); w = (this.rdW(d) - 1) & 0xffff; this.wrDp(d, w & 0xff); this.wrDp((d + 1) & 0xff, w >> 8); this.n = w >> 15; this.z = w === 0 ? 1 : 0; break;
      case 0x3a: d = this.fetch(); w = (this.rdW(d) + 1) & 0xffff; this.wrDp(d, w & 0xff); this.wrDp((d + 1) & 0xff, w >> 8); this.n = w >> 15; this.z = w === 0 ? 1 : 0; break;
      case 0x5a: { d = this.fetch(); w = this.rdW(d); const ya = this.y << 8 | this.a, r2 = ya - w; this.c = r2 >= 0 ? 1 : 0; this.n = (r2 >> 15) & 1; this.z = (r2 & 0xffff) === 0 ? 1 : 0; break; }
      case 0x7a: case 0x9a: {
        d = this.fetch(); w = this.rdW(d); if (op === 0x9a) w = (~w) & 0xffff;
        const ya = this.y << 8 | this.a, cin = op === 0x9a ? 1 : 0, r2 = ya + w + cin;
        this.h = ((ya & 0xfff) + (w & 0xfff) + cin) > 0xfff ? 1 : 0;
        this.v = (~(ya ^ w) & (ya ^ r2) & 0x8000) ? 1 : 0; this.c = r2 > 0xffff ? 1 : 0;
        const res = r2 & 0xffff; this.a = res & 0xff; this.y = res >> 8; this.n = res >> 15; this.z = res === 0 ? 1 : 0; break;
      }
      case 0xba: d = this.fetch(); this.a = this.rdDp(d); this.y = this.rdDp((d + 1) & 0xff); w = this.y << 8 | this.a; this.n = w >> 15; this.z = w === 0 ? 1 : 0; break;
      case 0xda: d = this.fetch(); this.wrDp(d, this.a); this.wrDp((d + 1) & 0xff, this.y); break;
      case 0x1e: this.cmp(this.x, this.rd(this.fetchW())); break;
      case 0x3e: this.cmp(this.x, this.rdDp(this.fetch())); break;
      case 0xc8: this.cmp(this.x, this.fetch()); break;
      case 0x5e: this.cmp(this.y, this.rd(this.fetchW())); break;
      case 0x7e: this.cmp(this.y, this.rdDp(this.fetch())); break;
      case 0xad: this.cmp(this.y, this.fetch()); break;
      case 0xcf: w = this.y * this.a; this.a = w & 0xff; this.y = w >> 8; this.nz(this.y); break;
      case 0x9e: {
        const ya = this.y << 8 | this.a, x = this.x;
        this.v = this.y >= x ? 1 : 0; this.h = (this.y & 15) >= (x & 15) ? 1 : 0;
        if (this.y < (x << 1)) { this.a = Math.floor(ya / x) & 0xff; this.y = (ya % x) & 0xff; }
        else { this.a = (255 - Math.floor((ya - (x << 9)) / (256 - x))) & 0xff; this.y = (x + (ya - (x << 9)) % (256 - x)) & 0xff; }
        this.nz(this.a); break;
      }
      case 0xdf: if (this.c || this.a > 0x99) { this.a = (this.a + 0x60) & 0xff; this.c = 1; } if (this.h || (this.a & 15) > 9) this.a = (this.a + 6) & 0xff; this.nz(this.a); break;
      case 0xbe: if (!this.c || this.a > 0x99) { this.a = (this.a - 0x60) & 0xff; this.c = 0; } if (!this.h || (this.a & 15) > 9) this.a = (this.a - 6) & 0xff; this.nz(this.a); break;
      case 0x9f: this.a = this.nz(this.a >> 4 | this.a << 4); break;
      case 0x60: this.c = 0; break;
      case 0x80: this.c = 1; break;
      case 0xed: this.c ^= 1; break;
      case 0xe0: this.v = 0; this.h = 0; break;
      case 0x20: this.p = 0; break;
      case 0x40: this.p = 1; break;
      case 0xa0: this.i = 1; break;
      case 0xc0: this.i = 0; break;
      case 0xef: case 0xff: this.stopped = true; break;
      // ---- MOV ----
      case 0xe8: this.a = this.nz(this.fetch()); break;
      case 0xe6: this.a = this.nz(this.rdDp(this.x)); break;
      case 0xbf: this.a = this.nz(this.rdDp(this.x)); this.x = (this.x + 1) & 0xff; break;
      case 0xe4: this.a = this.nz(this.rdDp(this.fetch())); break;
      case 0xf4: this.a = this.nz(this.rdDp((this.fetch() + this.x) & 0xff)); break;
      case 0xe5: this.a = this.nz(this.rd(this.fetchW())); break;
      case 0xf5: this.a = this.nz(this.rd(this.fetchW() + this.x)); break;
      case 0xf6: this.a = this.nz(this.rd(this.fetchW() + this.y)); break;
      case 0xe7: this.a = this.nz(this.rd(this.rdW((this.fetch() + this.x) & 0xff))); break;
      case 0xf7: this.a = this.nz(this.rd(this.rdW(this.fetch()) + this.y)); break;
      case 0xcd: this.x = this.nz(this.fetch()); break;
      case 0xf8: this.x = this.nz(this.rdDp(this.fetch())); break;
      case 0xf9: this.x = this.nz(this.rdDp((this.fetch() + this.y) & 0xff)); break;
      case 0xe9: this.x = this.nz(this.rd(this.fetchW())); break;
      case 0x8d: this.y = this.nz(this.fetch()); break;
      case 0xeb: this.y = this.nz(this.rdDp(this.fetch())); break;
      case 0xfb: this.y = this.nz(this.rdDp((this.fetch() + this.x) & 0xff)); break;
      case 0xec: this.y = this.nz(this.rd(this.fetchW())); break;
      case 0xc6: this.wrDp(this.x, this.a); break;
      case 0xaf: this.wrDp(this.x, this.a); this.x = (this.x + 1) & 0xff; break;
      case 0xc4: this.wrDp(this.fetch(), this.a); break;
      case 0xd4: this.wrDp((this.fetch() + this.x) & 0xff, this.a); break;
      case 0xc5: this.wr(this.fetchW(), this.a); break;
      case 0xd5: this.wr(this.fetchW() + this.x, this.a); break;
      case 0xd6: this.wr(this.fetchW() + this.y, this.a); break;
      case 0xc7: this.wr(this.rdW((this.fetch() + this.x) & 0xff), this.a); break;
      case 0xd7: this.wr(this.rdW(this.fetch()) + this.y, this.a); break;
      case 0xd8: this.wrDp(this.fetch(), this.x); break;
      case 0xd9: this.wrDp((this.fetch() + this.y) & 0xff, this.x); break;
      case 0xc9: this.wr(this.fetchW(), this.x); break;
      case 0xcb: this.wrDp(this.fetch(), this.y); break;
      case 0xdb: this.wrDp((this.fetch() + this.x) & 0xff, this.y); break;
      case 0xcc: this.wr(this.fetchW(), this.y); break;
      case 0x7d: this.a = this.nz(this.x); break;
      case 0xdd: this.a = this.nz(this.y); break;
      case 0x5d: this.x = this.nz(this.a); break;
      case 0xfd: this.y = this.nz(this.a); break;
      case 0x9d: this.x = this.nz(this.sp); break;
      case 0xbd: this.sp = this.x; break;
      case 0xfa: v = this.rdDp(this.fetch()); this.wrDp(this.fetch(), v); break;
      case 0x8f: v = this.fetch(); this.wrDp(this.fetch(), v); break;
      default: throw new Error('unhandled opcode ' + op.toString(16) + ' at ' + ((this.pc - 1) & 0xffff).toString(16));
    }
    this.tick(CYC[op] + extra);
  }
  run(cycles) { const end = this.cycles + cycles; while (this.cycles < end) this.step(); }
}
SPC700.IPL = IPL;
module.exports = { SPC700 };

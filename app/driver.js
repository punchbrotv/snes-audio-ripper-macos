// Talks to a game's sound program the way the game's main CPU does, using the SPC700 emulator:
// boot from upload blocks, answer the start-up handshake, send commands, and work out song loops.
'use strict';
const { SPC700 } = require('./spc700');

function runUntil(c, cond, maxCyc) { const end = c.cycles + maxCyc; while (c.cycles < end) { c.step(); if (cond()) return true; } return false; }
const inIpl = c => c.pc >= 0xffc0 || c.stopped;

// A blank sound chip holding only the given upload blocks, started at the driver's entry point
function boot(rom, blocks, entry) {
  const aram = new Uint8Array(65536);
  for (const b of blocks) aram.set(rom.subarray(b.rom, b.rom + b.len), b.dest);
  const c = new SPC700(aram, { pc: entry, sp: 0xef });
  // Many drivers say hello on port 0 and wait for the game to echo it back. Echo the first value once,
  // and stop as soon as the driver moves on (echoing later values would look like a new command).
  if (runUntil(c, () => c.portOut[0] !== 0 || inIpl(c), 512000) && !inIpl(c)) {
    const hello = c.portOut[0];
    c.portIn[0] = hello;
    runUntil(c, () => c.portOut[0] !== hello || inIpl(c), 512000);
  }
  if (inIpl(c)) return { ok: false, why: 'driver jumped to the boot ROM during start-up' };
  // settle: clear the ports the way the game does once the driver is ready
  c.portIn = [0, 0, 0, 0];
  c.run(20480);
  if (inIpl(c)) return { ok: false, why: 'driver jumped to the boot ROM' };
  return { ok: true, c };
}

// Send one command; returns false if the driver never acknowledges it
function send(c, p) {
  const before = c.portOut[0];
  c.portIn = p.slice(0, 4);
  const ok = runUntil(c, () => c.portOut[0] !== before || inIpl(c), 400000) && !inIpl(c);
  c.portIn = [0, 0, 0, 0];
  return ok;
}

// The chip state right now, in the form spc.js's buildSpc() expects
function snapshot(c) {
  const aram = Buffer.from(c.ram);
  aram[0xf4] = aram[0xf5] = aram[0xf6] = aram[0xf7] = 0;
  aram[0xfd] = aram[0xfe] = aram[0xff] = 0;
  aram[0xf2] = c.dspAddr;
  return { aram, regs: { pc: c.pc, a: c.a, x: c.x, y: c.y, sp: c.sp, psw: c.psw() }, dsp: Buffer.from(c.dsp) };
}

// Find where a song repeats from its note-on events. Returns { start, period } in seconds, or null.
function findLoop(events, cyclesPerSec = 1024000) {
  const ev = events.map(e => ({ t: e.t / cyclesPerSec, k: e.voice * 65536 + e.srcn * 256 + (e.pitch >> 6) }));
  if (ev.length < 24) return null;
  const end = ev[ev.length - 1].t, TOL = 0.004;
  const byKey = new Map();
  ev.forEach((e, i) => { if (!byKey.has(e.k)) byKey.set(e.k, []); byKey.get(e.k).push(i); });
  const hasAt = (k, t) => { const list = byKey.get(k); if (!list) return false; let lo = 0, hi = list.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1, d = ev[list[m]].t - t; if (Math.abs(d) <= TOL) return true; if (d < 0) lo = m + 1; else hi = m - 1; } return false; };
  for (let s = 0; s < Math.min(ev.length, 400); s++) {
    const a = ev[s];
    for (const j of byKey.get(a.k)) {
      if (j <= s) continue;
      const P = ev[j].t - a.t;
      if (P < 4 || a.t + 2 * P > end + 0.01) continue;
      let ok = true, n = 0;
      for (let i = s; i < ev.length && ev[i].t < a.t + P; i++) { n++; if (!hasAt(ev[i].k, ev[i].t + P)) { ok = false; break; } }
      if (ok && n >= 8) return { start: a.t, period: P };
    }
  }
  return null;
}

// Start a song and study it: when its notes begin, whether/where it loops, or when it ends
function studySong(c, cmd, seconds = 300) {
  const ok = send(c, cmd);
  if (!ok) return { ok: false, why: 'command not acknowledged' };
  const snap = snapshot(c), t0 = c.cycles, e0 = c.events.length;
  let lastKey = t0;
  const end = t0 + seconds * 1024000;
  while (c.cycles < end) { c.step(); if (inIpl(c)) break; if (c.events.length && c.events[c.events.length - 1].t > lastKey) lastKey = c.events[c.events.length - 1].t; }
  const ev = c.events.slice(e0).map(e => ({ ...e, t: e.t - t0 }));
  return { ok: true, snap, events: ev, loop: findLoop(ev), lastNote: (lastKey - t0) / 1024000, srcns: [...new Set(ev.map(e => e.srcn))] };
}

module.exports = { boot, send, snapshot, findLoop, studySong, runUntil };

// Experimental, game-independent DSP-command transcription to Standard MIDI File type 1.
// MIDI carries editable performance data, not the console's instrument samples or DSP effects.
'use strict';
const { SPC700 } = require('./spc700');
const { decodeBRRAt } = require('./brr');
const CLOCK = 1024000, PPQ = 480, TICKS_PER_SECOND = 960;
const tick = () => new Promise(r => setImmediate(r));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const signedVolume = n => Math.abs(n > 127 ? n - 256 : n);

// Estimate a tonal sample's fundamental at the DSP's unity playback rate.
// Unpitched/uncertain samples use C4 as an editable placeholder, never a claimed recovered pitch.
function fundamental(pcm, rate = 32000) {
  const n = Math.min(pcm.length, 4096);
  if (n < 128) return null;
  const step = 4, count = Math.floor(n / step), x = new Float64Array(count);
  let mean = 0;
  for (let i = 0; i < count; i++) mean += pcm[i * step];
  mean /= count;
  let energy = 0;
  for (let i = 0; i < count; i++) { x[i] = pcm[i * step] - mean; energy += x[i] * x[i]; }
  if (energy / count < 400) return null;
  const maxLag = Math.min(Math.floor(count / 2), 200), scores = [];
  for (let lag = 4; lag <= maxLag; lag++) {
    let dot = 0, a = 0, b = 0;
    for (let i = 0; i < count - lag; i++) { dot += x[i] * x[i + lag]; a += x[i] ** 2; b += x[i + lag] ** 2; }
    scores[lag] = dot / Math.sqrt(a * b || 1);
  }
  for (let lag = 5; lag < maxLag; lag++) {
    if (scores[lag] > 0.88 && scores[lag] >= scores[lag - 1] && scores[lag] > scores[lag + 1]) {
      const den = scores[lag - 1] - 2 * scores[lag] + scores[lag + 1];
      const offset = den ? clamp(0.5 * (scores[lag - 1] - scores[lag + 1]) / den, -0.5, 0.5) : 0;
      return rate / step / (lag + offset);
    }
  }
  return null;
}

async function trace(spc, seconds) {
  if (!Buffer.isBuffer(spc) || spc.length < 0x10180 || !spc.toString('ascii', 0, 27).startsWith('SNES-SPC700 Sound File Data')) throw new Error('MIDI requires a valid SPC sound state.');
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) throw new Error('Invalid MIDI duration.');
  const ram = spc.subarray(0x100, 0x10100);
  const c = new SPC700(ram, { pc: spc.readUInt16LE(0x25), a: spc[0x27], x: spc[0x28], y: spc[0x29], psw: spc[0x2a], sp: spc[0x2b] }, spc.subarray(0x10100, 0x10180));
  c.portIn = [...ram.subarray(0xf4, 0xf8)];
  const notes = [], active = Array(8).fill(null), tuning = new Map();
  let approximate = 0;
  const now = () => Math.min(seconds, c.cycles / CLOCK);
  function end(v) { if (active[v]) { active[v].end = Math.min(active[v].end, now()); active[v] = null; } }
  function read(v) {
    const b = v * 16, srcn = c.dsp[b + 4], pitch = c.dsp[b + 2] | (c.dsp[b + 3] & 63) << 8;
    const l = signedVolume(c.dsp[b]), r = signedVolume(c.dsp[b + 1]);
    return { srcn, pitch, velocity: clamp(Math.round((l + r) / 2), 1, 127), pan: l + r ? Math.round(127 * r / (l + r)) : 64 };
  }
  function start(v) {
    end(v);
    const state = read(v); if (!state.pitch || (c.dsp[0x5c] >> v & 1)) return;
    const dir = c.dsp[0x5d] << 8, at = (dir + state.srcn * 4) & 0xffff;
    const addr = c.ram[at] | c.ram[(at + 1) & 0xffff] << 8;
    const key = `${dir}:${state.srcn}:${addr}`;
    if (!tuning.has(key)) {
      const pcm = decodeBRRAt(c.ram, addr);
      let pos=addr, flags=2;
      for(let i=0;i<8000&&pos+9<=65536;i++,pos+=9){if(c.ram[pos]&1){flags=c.ram[pos];break;}}
      tuning.set(key,{ hz: fundamental(pcm), duration: pcm.length / 32000, loop: !!(flags & 2) });
    }
    const sample = tuning.get(key), hz = (c.dsp[0x3d] >> v & 1) ? null : sample.hz;
    const base = hz ? 69 + 12 * Math.log2(hz / 440) : 60;
    if (!hz) approximate++;
    const value = base + 12 * Math.log2(state.pitch / 4096), note = clamp(Math.round(value), 0, 127);
    const n = { voice: v, start: now(), end: sample.loop ? seconds : Math.min(seconds, now() + sample.duration * 4096 / state.pitch), note, srcn: state.srcn, velocity: state.velocity, pan: state.pan, bends: [{ time: now(), semitones: value - note }], base };
    notes.push(n); active[v] = n;
  }
  c.onDspWrite = (reg, value) => {
    for(let v=0;v<8;v++) if(active[v] && active[v].end <= now()) active[v]=null;
    if (reg === 0x5c) { for (let v = 0; v < 8; v++) if (value >> v & 1) end(v); }
    else if (reg === 0x4c) { for (let v = 0; v < 8; v++) if (value >> v & 1) start(v); }
    else if (reg === 0x6c && (value & 0xc0)) { for (let v = 0; v < 8; v++) end(v); }
    else if ((reg & 15) === 2 || (reg & 15) === 3) {
      const v = reg >> 4, n = active[v], pitch = read(v).pitch;
      if (n && pitch) {
        const semitones = n.base + 12 * Math.log2(pitch / 4096) - n.note, last = n.bends[n.bends.length - 1];
        if (Math.abs(last.semitones - semitones) > 0.02) {
          if(now()-last.time<0.001) last.semitones=semitones;
          else n.bends.push({ time: now(), semitones });
        }
      }
    }
  };
  // ENVX identifies voices that were already sounding at the snapshot boundary.
  for (let v = 0; v < 8; v++) if (c.dsp[v * 16 + 8] > 0) start(v);
  const endCycle = Math.round(seconds * CLOCK);
  while (c.cycles < endCycle && !c.stopped) {
    c.run(Math.min(CLOCK / 4, endCycle - c.cycles));
    c.events.length = 0; // discovery-only events aren't needed by this observer
    if (notes.length > 200000) throw new Error('MIDI note limit exceeded.');
    await tick();
  }
  for (let v = 0; v < 8; v++) end(v);
  return { notes: notes.filter(n => n.end > n.start), approximate };
}
function vlq(n) {
  if (!Number.isSafeInteger(n) || n < 0 || n > 0x0fffffff) throw new Error('Invalid MIDI delta time.');
  const a = [n & 127]; while ((n = Math.floor(n / 128))) a.unshift((n & 127) | 128); return Buffer.from(a);
}
function meta(type, text) { const b = Buffer.from(text, 'utf8'); return Buffer.concat([Buffer.from([255, type]), vlq(b.length), b]); }
function chunk(id, data) { const h = Buffer.alloc(8); h.write(id); h.writeUInt32BE(data.length, 4); return Buffer.concat([h, data]); }
function track(events, seconds) {
  events.sort((a, b) => a.t - b.t || a.order - b.order);
  let prev = 0; const parts = [];
  for (const e of events) { const at = Math.max(prev, Math.round(e.t * TICKS_PER_SECOND)); parts.push(vlq(at - prev), Buffer.from(e.bytes)); prev = at; }
  parts.push(vlq(Math.max(0, Math.round(seconds * TICKS_PER_SECOND) - prev)), Buffer.from([255,47,0]));
  return chunk('MTrk', Buffer.concat(parts));
}
function encode(notes, seconds, title = 'SNES voice transcription') {
  const head = Buffer.alloc(6); head.writeUInt16BE(1); head.writeUInt16BE(9, 2); head.writeUInt16BE(PPQ, 4);
  const tracks = [track([{ t: 0, order: 0, bytes: meta(3,title) }, { t: 0, order: 1, bytes: [255,81,3,7,161,32] },
    { t: 0, order: 2, bytes: meta(1,'Experimental DSP transcription. Assign instruments; sample tuning is estimated. Unpitched samples use a C4 root with relative pitch. DSP effects and envelopes are not reproduced.') }], seconds)];
  for (let ch = 0; ch < 8; ch++) {
    const events = [{ t: 0, order: -10, bytes: meta(3,`Voice ${ch + 1} - assign instrument`) }];
    const add = (t, order, bytes) => events.push({ t, order, bytes });
    add(0,-9,[0xc0|ch,0]); // neutral piano placeholder, never map sample IDs to GM patches
    for (const [cc,v] of [[101,0],[100,0],[6,24],[38,0],[101,127],[100,127]]) add(0,-8,[0xb0|ch,cc,v]);
    for (const n of notes.filter(n => n.voice === ch)) {
      add(n.start,1,meta(6,`Sample ${n.srcn}`)); add(n.start,2,[0xb0|ch,10,n.pan]);
      for (const b of n.bends) { if (b.time >= n.end) continue; const v=clamp(Math.round(8192+b.semitones/24*8192),0,16383); add(b.time,3,[0xe0|ch,v&127,v>>7]); }
      add(n.start,4,[0x90|ch,n.note,n.velocity]); add(Math.max(n.end,n.start+1/TICKS_PER_SECOND),0,[0x80|ch,n.note,0]);
    }
    add(seconds,10,[0xb0|ch,123,0]); tracks.push(track(events,seconds));
  }
  return Buffer.concat([chunk('MThd',head),...tracks]);
}
async function fromAudioState(audio, seconds, title) {
  if (!audio.spc) return null;
  const data = await trace(audio.spc, seconds);
  if (audio.baselineSpc) {
    const baseline = (await trace(audio.baselineSpc,seconds)).notes;
    // Remove notes already present without the command; keep the newly triggered performance.
    const groups = new Map();
    for (const n of baseline) { const k=`${n.voice}:${n.srcn}:${n.note}`; if(!groups.has(k))groups.set(k,[]);groups.get(k).push(n.start); }
    data.notes=data.notes.filter(n=>!(groups.get(`${n.voice}:${n.srcn}:${n.note}`)||[]).some(t=>Math.abs(t-n.start)<0.004));
  }
  if (!data.notes.length) return null;
  return { bytes: encode(data.notes,seconds,title), notes:data.notes.length, approximate:data.approximate };
}
module.exports = { encode, trace, fromAudioState, fundamental, vlq };

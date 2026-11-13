'use strict';
// Musical time is separate from performance time. Never quantize the performance.
function validate(value) {
  const { originSeconds = 0, tempo, meter = [4, 4] } = value || {};
  if (!Number.isFinite(originSeconds) || originSeconds < 0 || originSeconds > 600 || !Array.isArray(tempo) || !tempo.length || tempo.length > 4096 ||
      !Array.isArray(meter) || meter.length !== 2 || !Number.isInteger(meter[0]) || meter[0] < 1 || meter[0] > 32 || ![1,2,4,8,16].includes(meter[1])) throw Error('Invalid musical timing profile.');
  let previous = -1;
  const points = tempo.map(p => {
    if (!p || !Number.isFinite(p.time) || p.time < 0 || p.time > 600 || p.time <= previous || !Number.isFinite(p.bpm) || p.bpm < 20 || p.bpm > 400) throw Error('Invalid tempo point. Use increasing times in seconds and BPM from 20 to 400.');
    previous = p.time;
    return { time: p.time, bpm: Math.round(p.bpm * 10000) / 10000 };
  });
  if (points[0].time !== 0) throw Error('The tempo map must start at time 0.');
  return { originSeconds, tempo: points, meter: [...meter] };
}
function clock(timing, ppq = 960) {
  const points = validate(timing).tempo;
  let beat = 0;
  const segments = points.map((p, i) => {
    if (i) beat += (p.time - points[i-1].time) * points[i-1].bpm / 60;
    return { ...p, beat };
  });
  function beats(seconds) {
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (segments[mid].time <= seconds) lo = mid; else hi = mid - 1; }
    const p = segments[lo]; return p.beat + (seconds - p.time) * p.bpm / 60;
  }
  const origin = timing.originSeconds || 0, offset = beats(origin);
  const toTick = seconds => Math.max(0, Math.round((beats(seconds) - offset) * ppq));
  const initial = segments.filter(p => p.time <= origin).at(-1);
  // Tempo changes round to the SAME grid as notes/controllers; last change at a tick wins.
  const map = new Map([[0, initial.bpm]]);
  for (const p of segments) if (p.time > origin) map.set(toTick(p.time), p.bpm);
  return { toTick, tempo: [...map].map(([tick, bpm]) => ({ tick, bpm })) };
}
function estimate(notes) {
  const valid = notes.filter(n => Number.isFinite(n.start) && n.start >= 0);
  const origin = valid.reduce((v, n) => Math.min(v, n.start), Infinity);
  // Per-voice periodicity tolerates deliberate echoes and staggered instrument attacks.
  const selected = [...new Set(valid.map(n => n.voice))].map(voice => ({ voice,
    times: valid.filter(n => n.voice === voice && n.start < origin + 30).map(n => n.start - origin) }))
    .filter(g => g.times.length >= 12 && g.times.at(-1) - g.times[0] >= 4).sort((a,b) => b.times.length-a.times.length).slice(0,3);
  const sample = (a, limit) => a.filter((_, i) => i % Math.max(1, Math.ceil(a.length / limit)) === 0);
  const voices = selected.map(g => sample(g.times, 240));
  if (!voices.length) return null;
  function coherence(bpm, division = 12, groups = voices) {
    let sum = 0, count = 0;
    for (const times of groups) {
      let re = 0, im = 0; const k = 2 * Math.PI * bpm / 60 * division;
      for (const time of times) { re += Math.cos(time*k); im += Math.sin(time*k); }
      sum += Math.hypot(re, im); count += times.length;
    }
    return sum / count;
  }
  const candidates = [];
  for (let i = 3000; i <= 10000; i++) { const bpm = i / 50; candidates.push({ bpm, fit: coherence(bpm) }); }
  candidates.sort((a,b) => b.fit-a.fit);
  const peaks = [];
  for (const c of candidates) {
    if (peaks.some(p => Math.abs(p.bpm-c.bpm) < 1)) continue;
    let best = c;
    for (let i = -60; i <= 60; i++) { const bpm = c.bpm+i*.0005, fit = coherence(bpm); if (fit > best.fit) best = { bpm, fit }; }
    best.rank = best.fit*.45 + coherence(best.bpm,1)*.3 + coherence(best.bpm,2)*.15 + coherence(best.bpm,4)*.1;
    peaks.push(best); if (peaks.length === 10) break;
  }
  peaks.sort((a,b) => b.rank-a.rank);
  const best = peaks[0];
  if (best.fit < .8 || best.rank < .5) return null;
  // Refine against the entire song, and reject a fixed grid that drifts or changes tempo.
  const full = selected.map(g => sample(valid.filter(n => n.voice === g.voice).map(n => n.start-origin), 500));
  let refined = { bpm: best.bpm, fit: coherence(best.bpm,12,full) };
  for (let i = -100; i <= 100; i++) { const bpm=best.bpm+i*.0002, fit=coherence(bpm,12,full); if(fit>refined.fit)refined={bpm,fit}; }
  if (refined.fit < .75) return null;
  return { ...validate({originSeconds:origin,tempo:[{time:0,bpm:refined.bpm}]}), source:'estimated', confidence:Math.round(refined.fit*1000)/1000 };
}
function resolve(notes, provided, infer = true) {
  if (provided) {
    const timing = validate(provided), first = notes.reduce((t,n)=>Math.min(t,n.start),Infinity);
    if (timing.originSeconds > first + .000001) throw Error('Timing origin would remove existing notes.');
    return { ...timing, source:'profile' };
  }
  return (infer && estimate(notes)) || { originSeconds:0,tempo:[{time:0,bpm:120}],meter:[4,4],source:'unresolved' };
}
module.exports = { validate, clock, estimate, resolve };

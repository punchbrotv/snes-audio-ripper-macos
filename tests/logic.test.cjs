const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),{execFileSync}=require('child_process');
const {samplerNotes,prepare}=require('../app/logic'),Midi=require('../app/midi'),{buildSpc}=require('../app/spc');
const helper=path.resolve('app/helpers/logic-writer/logic-writer');

test('Logic keeps exact relative sample pitch and captures sample changes at key-on',async()=>{
 const aram=Buffer.alloc(65536),dsp=Buffer.alloc(128),code=[];
 const write=(r,v)=>code.push(0x8f,r,0xf2,0x8f,v,0xf3);
 for(const [r,v] of [[0,100],[1,80],[2,0],[3,8],[4,0],[0x5d,0x20]])write(r,v);
 write(0x4c,1);code.push(...Array(1000).fill(0));write(0x5c,1);
 code.push(0xe8,0x77,0xc5,0x01,0x30); // replace sample bytes at the SAME RAM address
 write(0x5c,0);write(0x4c,1);code.push(...Array(1000).fill(0));write(0x5c,1);code.push(0xef);
 aram.set(code,0x500);aram.writeUInt16LE(0x3000,0x2000);aram.writeUInt16LE(0x3009,0x2002);
 aram[0x3000]=0x80;aram[0x3009]=0x83;
 const spc=buildSpc({aram,dsp,regs:{pc:0x500,a:0,x:0,y:0,psw:0,sp:0xef}},{seconds:1});
 const result=await Midi.trace(spc,.1,{samples:true});
 assert.equal(result.notes.length,2);assert.equal(result.samples.length,2);
 assert.notEqual(result.notes[0].instrument,result.notes[1].instrument);
 assert.equal(result.samples[0].loopStart,16);assert.equal(result.samples[0].pcm.length,32);
 assert.equal(result.notes[0].note,48); // pitch 2048 = exactly one octave below unity
 assert.equal(result.notes[0].bends[0].semitones,0);
 assert.equal(await Midi.transcribe({spc,baselineSpc:spc},.1,{samples:true}),null);
});
test('wide bends remain contiguous and inside the native Sampler range',()=>{
 const note={voice:0,start:0,end:3,note:60,velocity:90,pan:64,instrument:'a',bends:[{time:0,semitones:0},{time:1,semitones:20},{time:2,semitones:40}]};
 const segments=samplerNotes(note);assert.equal(segments.length,2);
 assert.equal(segments[0].end,segments[1].start);assert.equal(segments[1].end,3);
 for(const n of segments)for(const b of n.bends){
  assert.ok(Math.abs(b.semitones)<=12);
  const original=note.bends.find(x=>x.time===b.time);
  assert.ok(Math.abs(n.note+n.detune+b.semitones-(note.note+original.semitones))<1e-9);
 }
 const s={id:'a',srcn:4,pcm:Int16Array.from([123,-456,789,-1000]),loop:true,loopStart:1};
 const spec=prepare({samples:[s],notes:[note,{...note,voice:1}]});
 assert.equal(spec.tracks.length,2);assert.equal(spec.retriggers,2);
 assert.deepEqual(Buffer.from(Object.values(spec.samples)[0].pcm,'base64'),Buffer.from(s.pcm.buffer));
});
test('packaged Logic writer produces linked sampler tracks, MIDI events and original WAVs',{skip:!fs.existsSync(helper)},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snes-logic-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const pcm=Int16Array.from({length:320},(_,i)=>10000*Math.sin(i*2*Math.PI/80));
 const data=prepare({samples:[{id:'tone',srcn:3,pcm,loop:true,loopStart:80}],notes:[0,1,2].map(voice=>({voice,instrument:'tone',start:0,end:1,note:60,velocity:90,pan:64,bends:[{time:0,semitones:0},{time:.5,semitones:2}]}))});
 const out=path.join(dir,'Song.logicx'),result=JSON.parse(execFileSync(helper,[out,path.resolve('app/logic-data/sampler.bin')],{input:JSON.stringify(data),encoding:'utf8'}));
 assert.deepEqual(result,{tracks:3,regions:3,samples:1,notes:3});
 const b=fs.readFileSync(path.join(out,'Alternatives/000/ProjectData'));
 assert.ok(b.includes(Buffer.from(data.tracks[0].name)),'Native project contains the descriptive track name');
 assert.equal(b.readUInt32LE(16),b.length-24);
 const records=[];for(let p=24;p<b.length;){const size=36+b.readUInt32LE(p+28);assert.ok(size>=36&&p+size<=b.length);records.push(b.subarray(p,p+size));p+=size;}
 const inserts=records.filter(r=>r.toString('ascii',0,4)==='UCuA'&&r.toString('ascii',156,163)==='Sampler');assert.equal(inserts.length,3);
 for(const r of inserts){
  const ordinal=r.readUInt32LE(12),strip=records.find(s=>s.toString('ascii',0,4)==='OCuA'&&s.readUInt32LE(12)===ordinal);
  assert.ok(strip.readUInt16LE(62)>=4);assert.equal(strip.readUInt32LE(176),1);
  assert.ok(r.includes(Buffer.from('sample-')));
 }
 for(const g of data.tracks){
  const iv=records.find(r=>r.toString('ascii',0,4)==='ivnE'&&r.subarray(196,196+r.readUInt16LE(194)).toString()===g.name);
  assert.equal(iv.readUInt16LE(0xb8)&0xfff,g.style.iconId);assert.equal(iv[0xbf],g.style.colorIndex);
  const region=records.find(r=>r.toString('ascii',0,4)==='qeSM'&&r.subarray(54,54+r.readUInt16LE(52)).toString()===g.name);
  const n=region.readUInt16LE(52);assert.equal(region[54+n+(n&1)+9],g.style.colorIndex);
 }
 const events=records.filter(r=>r.toString('ascii',0,4)==='qSvE'&&r.readUInt32LE(8)>=0x1200000&&r[36]===0xb0);
 assert.equal(events.length,3);
 for(const r of events){let p=36,notes=0,bends=0;while(r[p]!==0xf1){const status=r[p];if(status===0x90){notes++;p+=32}else{if(status===0xe0)bends++;p+=16}}assert.equal(notes,1);assert.equal(bends,2)}
 const waves=fs.readdirSync(path.join(out,'Media/Samples'));assert.equal(waves.length,1);
 const wav=fs.readFileSync(path.join(out,'Media/Samples',waves[0]));assert.deepEqual(wav.subarray(44),Buffer.from(pcm.buffer));
 assert.equal(wav.readUInt32LE(24),32000);
});
test('native Logic tempo map retimes notes, note lengths and bends without changing performance seconds',{skip:!fs.existsSync(helper)},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snes-grid-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const data=prepare({samples:[{id:'tone',srcn:1,pcm:Int16Array.from([100,-100,100,-100]),loop:true,loopStart:0}],notes:[{voice:0,instrument:'tone',start:.25,end:2.25,note:60,velocity:90,pan:64,bends:[{time:.25,semitones:0},{time:1.75,semitones:1}]}]});
 data.timing={originSeconds:.25,tempo:[{time:0,bpm:150},{time:1.25,bpm:90}],meter:[3,4]};
 const out=path.join(dir,'Tempo.logicx');execFileSync(helper,[out,path.resolve('app/logic-data/sampler.bin')],{input:JSON.stringify(data)});
 const b=fs.readFileSync(path.join(out,'Alternatives/000/ProjectData')),records=[];
 for(let p=24;p<b.length;){const size=36+b.readUInt32LE(p+28);records.push(b.subarray(p,p+size));p+=size;}
 const tempo=records.find(r=>r.toString('ascii',0,4)==='qSvE'&&r[36]===0x60);
 assert.equal(tempo.readUInt32LE(40)-38400,0);assert.equal(tempo.readUInt32LE(52),1500000);
 assert.equal(tempo.readUInt32LE(72)-38400,2400);assert.equal(tempo.readUInt32LE(84),900000);
 const events=records.find(r=>r.toString('ascii',0,4)==='qSvE'&&r.readUInt32LE(8)>=0x1200000&&r[36]===0xb0);
 let note,bend;
 for(let p=36;events[p]!==0xf1;){if(events[p]===0x90){note=events.subarray(p,p+32);p+=32;}else{if(events[p]===0xe0&&events.readUInt32LE(p+4)>38400)bend=events.subarray(p,p+16);p+=16;}}
 assert.equal(note.readUInt32LE(4)-38400,0);assert.equal(note.readUInt32LE(28),3840);
 assert.equal(bend.readUInt32LE(4)-38400,3120);
});
test('native Logic places source-beat attacks exactly and retains fractional-beat echoes',{skip:!fs.existsSync(helper)},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snes-score-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const anchors=[[.05,0],[.56,1],[.58,1+1/24],[.82,1.5],[.987,1+5/6],[1.067,2]];
 const notes=anchors.map(([start])=>({voice:0,instrument:'tone',start,end:start+.03,note:60,velocity:90,pan:64,bends:[{time:start,semitones:0}]}));
 const data=prepare({samples:[{id:'tone',srcn:1,pcm:Int16Array.from([100,-100]),loop:true,loopStart:0}],notes});
 data.timing={originSeconds:.05,tempo:[{time:0,bpm:120}],beatAnchors:anchors};
 const out=path.join(dir,'Score.logicx');execFileSync(helper,[out,path.resolve('app/logic-data/sampler.bin')],{input:JSON.stringify(data)});
 const b=fs.readFileSync(path.join(out,'Alternatives/000/ProjectData'));let events;
 for(let p=24;p<b.length;){const size=36+b.readUInt32LE(p+28),r=b.subarray(p,p+size);if(r.toString('ascii',0,4)==='qSvE'&&r.readUInt32LE(8)>=0x1200000&&r[36]===0xb0)events=r;p+=size;}
 const starts=[];for(let p=36;events[p]!==0xf1;){if(events[p]===0x90){starts.push(events.readUInt32LE(p+4)-38400);p+=32}else p+=16;}
 assert.deepEqual(starts,[0,960,1000,1440,1760,1920]);
});
test('native Logic splits rests longer than one measure and preserves absolute notes and controllers',{skip:!fs.existsSync(helper)},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snes-phrases-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const meter of [[4,4],[3,4],[6,8]]){
  const bar=meter[0]*3840/meter[1],c=1200+bar,d=c+240+bar+1,e=d+120,f=e+bar+600,g=e+bar*3+bar+1;
  const spans=[[240,960],[480,1200],[c,c+240],[d,d+240],[e,e+bar*3],[f,f+120],[g,g+480]];
  const notes=spans.map(([start,end],i)=>({voice:0,instrument:'tone',start:start/1920,end:end/1920,note:60,velocity:80+i,pan:30+i,bends:[{time:start/1920,semitones:0},{time:(start+12)/1920,semitones:.5}]}));
  const data=prepare({samples:[{id:'tone',srcn:1,pcm:Int16Array.from([100,-100]),loop:true,loopStart:0}],notes});
  data.timing={originSeconds:0,tempo:[{time:0,bpm:120}],meter};
  const out=path.join(dir,meter.join('-')+'.logicx');
  const result=JSON.parse(execFileSync(helper,[out,path.resolve('app/logic-data/sampler.bin')],{input:JSON.stringify(data),encoding:'utf8'}));
  assert.equal(result.regions,3);assert.equal(result.notes,7);
  const b=fs.readFileSync(path.join(out,'Alternatives/000/ProjectData')),records=[];
  for(let p=24;p<b.length;){const size=36+b.readUInt32LE(p+28);records.push(b.subarray(p,p+size));p+=size;}
  const regions=records.filter(r=>r.toString('ascii',0,4)==='qeSM'&&r.readUInt32LE(8)>=0x1200000),actual=[],controllers=[];
  assert.equal(regions.length,3);
  regions.forEach((r,i)=>{
   const n=r.readUInt16LE(52),tail=54+n+(n&1),start=r.readUInt32LE(tail+224),length=r.readUInt32LE(tail+60);
   assert.equal(start,[240,d,g][i]);assert.equal(start+length,[c+240,e+bar*3,g+480][i]);assert.equal(r[tail+9],data.tracks[0].style.colorIndex);
   const ev=records.find(q=>q.toString('ascii',0,4)==='qSvE'&&q.readUInt32LE(8)===r.readUInt32LE(8));
   for(let p=36;ev[p]!==0xf1;){const time=start+ev.readUInt32LE(p+4)-38400;
    if(ev[p]===0x90){actual.push([time,time+ev.readUInt32LE(p+28)]);p+=32;}
    else{controllers.push([ev[p],time]);p+=16;}
   }
   const placements=records.find(q=>q.toString('ascii',0,4)==='qSvE'&&q.readUInt32LE(8)===0x40000&&q[36]===0x20);
   let found=false;for(let p=36;p+56<=placements.length;p+=4){if(placements.readUInt32LE(p)===0x20&&placements.readUInt32LE(p+32)===(r.readUInt32LE(8)>>>16)){assert.equal(placements.readUInt32LE(p+4)-34560,start);found=true;break;}}
   assert.ok(found,'Region has matching arrange placement');
  });
  assert.deepEqual(actual,spans);
  assert.deepEqual(controllers.filter(([status])=>status===0xb0).map(([,time])=>time),spans.map(([start])=>start));
  assert.deepEqual(controllers.filter(([status])=>status===0xe0).map(([,time])=>time),spans.flatMap(([start])=>[start,start+12]));
 }
});
test('many phrase regions receive IDs clear of the expanded mixer pool',{skip:!fs.existsSync(helper)},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snes-many-phrases-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const notes=Array.from({length:20},(_,voice)=>Array.from({length:10},(_,i)=>({voice,instrument:'tone',start:i*3,end:i*3+.1,note:60,velocity:90,pan:64,bends:[{time:i*3,semitones:0}]}))).flat();
 const data=prepare({samples:[{id:'tone',srcn:1,pcm:Int16Array.from([100,-100]),loop:true,loopStart:0}],notes});
 const out=path.join(dir,'Many.logicx'),result=JSON.parse(execFileSync(helper,[out,path.resolve('app/logic-data/sampler.bin')],{input:JSON.stringify(data),encoding:'utf8'}));
 assert.equal(result.regions,200);assert.equal(result.notes,200);
 const b=fs.readFileSync(path.join(out,'Alternatives/000/ProjectData')),regions=[],other=new Set(),names=new Set(data.tracks.map(g=>g.name));
 for(let p=24;p<b.length;){const size=36+b.readUInt32LE(p+28),r=b.subarray(p,p+size);if(r.toString('ascii',0,4)==='qeSM'){
  const n=r.readUInt16LE(52),name=r.subarray(54,54+n).toString(),id=r.readUInt32LE(8);
  if(names.has(name))regions.push(id);else other.add(id);
 }p+=size;}
 assert.equal(regions.length,200);assert.equal(new Set(regions).size,200);assert.ok(regions.every(id=>!other.has(id)));
});

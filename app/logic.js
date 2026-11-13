'use strict';
const fs=require('fs'),path=require('path'),{spawn}=require('child_process'),crypto=require('crypto');
const Midi=require('./midi');
const Instruments=require('./instrument-names');
// Logic Sampler supports ±12 semitones. Recenter each note's curve; exceptionally
// wide sweeps become contiguous notes instead of silently clipping the bend.
function samplerNotes(note){
  const curves=note.bends.filter(b=>b.time<note.end), segments=[];
  let points=[],lo=Infinity,hi=-Infinity,start=note.start;
  const finish=end=>{
    if(!points.length||end<=start)return;
    const center=Math.round((lo+hi)/2),key=Math.max(0,Math.min(127,center)),detune=center-key;
    if(detune < -128 || detune > 127)throw Error('Pitch is outside Sampler tuning range.');
    segments.push({...note,start,end,note:key,detune,bends:points.map(b=>({time:b.time,semitones:note.note+b.semitones-center}))});
  };
  for(const b of curves){
    const value=note.note+b.semitones;
    if(points.length && Math.max(hi,value)-Math.min(lo,value)>23){finish(b.time);points=[];lo=Infinity;hi=-Infinity;start=b.time;}
    lo=Math.min(lo,value);hi=Math.max(hi,value);points.push(b);
  }
  finish(note.end);return segments;
}
function prepare(data,options={}){
  const samples={},groups=new Map(),source=new Map(data.samples.map(s=>[s.id,s]));
  let noiseNotes=0, retriggers=0;
  for(const original of data.notes){
    const notes=samplerNotes(original);retriggers+=Math.max(0,notes.length-1);
    for(const n of notes){
    const sample=source.get(n.instrument);if(!sample||!sample.pcm.length)throw Error('A note has no recoverable instrument sample.');
    const id='sample-'+crypto.createHash('sha256').update(n.instrument+':'+n.detune).digest('hex').slice(0,20);
    if(!samples[id])samples[id]={frames:sample.pcm.length,pcm:Buffer.from(sample.pcm.buffer,sample.pcm.byteOffset,sample.pcm.byteLength).toString('base64'),loop:sample.loop,loopStart:sample.loopStart,adsr1:sample.adsr1,adsr2:sample.adsr2,gain:sample.gain,detune:n.detune};
    const key=`${n.voice}:${id}`;
    if(!groups.has(key))groups.set(key,{sample:id,notes:[]});
    groups.get(key).notes.push(n);if(n.noise)noiseNotes++;
  }
  }
  const tracks=[...groups.values()];
  Instruments.nameTracks(tracks,source,options.instruments);
  return {samples,tracks,noiseNotes,retriggers};
}
function runWriter(spec,out){
  const helper=path.join(__dirname,'helpers/logic-writer/logic-writer');
  if(!fs.existsSync(helper))throw Error('Logic exporter is missing. Run npm run setup, or download the complete macOS app.');
  return new Promise((resolve,reject)=>{
    const child=spawn(helper,[out,path.join(__dirname,'logic-data/sampler.bin')],{stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',settled=false;
    const finish=(err,result)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(result)};
    const timer=setTimeout(()=>{child.kill();finish(Error('Logic project creation timed out.'))},120000);
    child.stdout.on('data',b=>{stdout+=b;if(stdout.length>100000){child.kill();finish(Error('Unexpected Logic exporter output.'))}});
    child.stderr.on('data',b=>{stderr=(stderr+b).slice(-8000)});
    child.on('error',e=>finish(e));child.stdin.on('error',()=>{});
    child.on('close',code=>{if(code!==0)return finish(Error(stderr.trim()||`Logic exporter exited (${code}).`));try{finish(null,JSON.parse(stdout))}catch{finish(Error('Invalid Logic exporter result.'))}});
    child.stdin.end(JSON.stringify(spec));
  });
}
async function write(file,audio,seconds,title,options={}){
  const data=await Midi.transcribe(audio,seconds,{samples:true});
  if(!data)throw Error('No recoverable instrument note events for this sound.');
  const spec=prepare(data,options),parent=path.dirname(file);
  spec.timing=require('./timing').resolve(data.notes,options.timing,options.inferTiming!==false);
  spec.destination=path.resolve(file);
  fs.mkdirSync(parent,{recursive:true});
  if(fs.existsSync(file))throw Error('Refusing to overwrite a Logic project.');
  const stage=fs.mkdtempSync(path.join(parent,'.logic-export-')),project=path.join(stage,'Session.logicx');
  try{
    const result=await runWriter(spec,project);
    const instruments=spec.tracks.map(g=>({trackName:g.name,sampleFile:g.sample+'.wav',...g.instrument}));
    fs.writeFileSync(path.join(project,'Instrument Guide.txt'),Instruments.guide(spec.tracks));
    fs.writeFileSync(path.join(project,'SNES Export.json'),JSON.stringify({version:1,title,seconds,timing:spec.timing,...result,instruments,noiseNotes:spec.noiseNotes,widePitchRetriggers:spec.retriggers,description:'Original BRR samples with editable notes, loops, pan and pitch bends. Sampler envelopes and console echo/noise/pitch modulation are approximate.'},null,2));
    fs.renameSync(project,file);return {...result,timing:spec.timing};
  }finally{fs.rmSync(stage,{recursive:true,force:true})}
}
module.exports={prepare,write,samplerNotes};

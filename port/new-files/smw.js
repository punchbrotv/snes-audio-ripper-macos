'use strict';
// Verified against the unmodified USA ROM and SMWDisX bank_00/bank_0E/bank_03.
// This profile reads audio data from the user's ROM; it contains no game assets.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const D = require('./driver');
const A = require('./analyse');
const { buildSpc } = require('./spc');
const { encode } = require('./mp3');
const HASH = '0838e531fe22c077528febe14cb3ff7c492f1f5fa8de354192bdff7137c27f5b';
const BANKS = [{name:'Overworld',offset:0x718b1,count:9},{name:'Level',offset:0x72ed6,count:29},{name:'Ending',offset:0x1e400,count:4}];
const SEC = 1024000;
const tick = () => new Promise(r => setImmediate(r));
function supports(rom) { return rom.length === 524288 && crypto.createHash('sha256').update(rom).digest('hex') === HASH; }
function readBlocks(rom, offset) {
  const blocks=[];
  for(let i=0;i<32;i++) {
    if(offset+4>rom.length)throw Error('Truncated audio upload');
    const len=rom.readUInt16LE(offset),dest=rom.readUInt16LE(offset+2);offset+=4;
    if(!len) {if(dest!==0x500)throw Error('Unexpected audio entry point');return blocks;}
    if(dest+len>65536||offset+len>rom.length)throw Error('Invalid audio upload');
    blocks.push({rom:offset,dest,len});offset+=len;
  }
  throw Error('Unterminated audio upload');
}
async function ripSmw(rom, dir, emit, log) {
  if(!supports(rom))return null;
  const renderer=require('./render');
  let music=0,sfx=0;
  const manifest=[];
  const common=[...readBlocks(rom,0x70000),...readBlocks(rom,0x78000)];
  const boot=bank=>{
    const b=D.boot(rom,[...common,...readBlocks(rom,bank.offset)],0x500);
    if(!b.ok)throw Error('SMW audio driver failed to start: '+b.why);
    return b.c;
  };
  async function save(kind,label,r,seconds,fade,extra) {
    const n=Math.min(r.left.length,Math.ceil(seconds*r.rate));
    const channels=[r.left.slice(0,n),r.right.slice(0,n)];
    const f=Math.min(n,Math.ceil(fade*r.rate));
    for(const a of channels)for(let i=0;i<f;i++)a[n-1-i]*=i/f;
    const file=`${kind}/${label}.mp3`;
    fs.writeFileSync(path.join(dir,file),await encode(channels,r.rate,160));
    if(kind==='Music')music++;else sfx++;
    manifest.push({file,seconds:n/r.rate,...extra});
    log(`saved ${file} (${(n/r.rate).toFixed(2)} s)`);
    emit({phase:'track',file,secs:n/r.rate,count:music+sfx});
  }
  for(const sub of ['Music','SFX'])fs.mkdirSync(path.join(dir,sub),{recursive:true});
  log('Verified Super Mario World USA profile: all three music banks; SFX ports 0, 1 and 3');
  try {
    let index=0;
    for(const bank of BANKS) {
      const seenPointers=new Set();
      for(let cmd=1;cmd<=bank.count;cmd++) {
        index++;
        const ptr=rom.readUInt16LE(bank.offset+4+(cmd-1)*2);
        if(seenPointers.has(ptr))continue;
        seenPointers.add(ptr);
        const label=`${bank.name}-${String(cmd).padStart(2,'0')}`;
        emit({phase:'record',pct:0.65*index/42,local:index/42,label:'READING MUSIC BANKS',sub:label});
        const c=boot(bank),snap=D.snapshot(c),ports=[0,0,cmd,0],start=c.cycles;
        c.portIn=ports.slice();
        // Learn the loop from note events, while yielding for responsive cancellation.
        for(let t=0;t<180;t++){c.run(SEC);if(t===0)c.portIn=[0,0,0,0];if(t%5===0)await tick();}
        const events=c.events.map(e=>({...e,t:e.t-start}));
        const loop=D.findLoop(events),last=events.length?events[events.length-1].t/SEC:0;
        const seconds=loop?Math.min(300,loop.start+2*loop.period+8):last<175?Math.max(2,last+4):180;
        const fade=loop||last>=175?8:0.15;
        const r=await renderer.render(buildSpc(snap,{ports,seconds:Math.ceil(seconds)}),90000);
        if(A.peak(A.rms(A.toMono(r.left,r.right),r.rate))<100)throw Error('Silent music render: '+label);
        await save('Music',label,r,seconds,fade,{bank:bank.offset,command:cmd,port:2,loop});
      }
    }
    const commands=[];
    for(const [port,count] of [[0,0x2a],[1,4],[3,0x34]])for(let cmd=1;cmd<=count;cmd++)commands.push({port,cmd});
    const seen=new Set();
    for(let i=0;i<commands.length;i++) {
      const {port,cmd}=commands[i],label=`Port${port}-${cmd.toString(16).toUpperCase().padStart(2,'0')}`;
      emit({phase:'record',pct:0.65+0.35*i/commands.length,local:i/commands.length,label:'READING SOUND EFFECTS',sub:label});
      const snap=D.snapshot(boot(BANKS[1])),ports=[0,0,0,0];ports[port]=cmd;
      const r=await renderer.render(buildSpc(snap,{ports,seconds:12}),20000);
      const en=A.rms(A.toMono(r.left,r.right),r.rate);
      if(A.peak(en)<100)continue;
      const key=crypto.createHash('sha256').update(Buffer.from(r.left.buffer)).update(Buffer.from(r.right.buffer)).digest('hex');
      if(seen.has(key))continue;seen.add(key);
      const end=Math.min(12,A.lastLoud(en,60)+0.25);
      await save('SFX',label,r,end,end>=11.9?0.5:0.025,{port,command:cmd});
    }
    fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({profile:'Super Mario World (USA)',romSHA256:HASH,music,sfx,tracks:manifest},null,2));
    return {music,sfx,total:music+sfx};
  } finally {renderer.shutdown();}
}
module.exports={supports,readBlocks,ripSmw};

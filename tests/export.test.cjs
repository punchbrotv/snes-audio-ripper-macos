const {test}=require('node:test'),assert=require('node:assert/strict');
const {encodeWav,parseWav}=require('../app/wav');
const Midi=require('../app/midi'),Export=require('../app/export');
const {buildSpc}=require('../app/spc');

test('WAV exports exact signed stereo PCM and a correct RIFF header',()=>{
 const L=Int16Array.from([-32768,-1,0,32767]),R=Int16Array.from([32767,0,-1,-32768]);
 const b=encodeWav([L,R],48000),r=parseWav(b);
 assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.readUInt32LE(4),b.length-8);
 assert.equal(b.readUInt16LE(20),1);assert.equal(b.readUInt32LE(28),192000);
 assert.deepEqual(r.left,L);assert.deepEqual(r.right,R);assert.equal(r.rate,48000);
 const mono=parseWav(encodeWav([L],16000));assert.deepEqual(mono.left,mono.right);
 assert.throws(()=>encodeWav([L,R.subarray(1)],48000),/matching/);
});
test('export choice is validated and defaults to MP3',()=>{
 assert.equal(Export.format(),'mp3');assert.equal(Export.extension(),'mp3');assert.equal(Export.extension('midi'),'mid');
 for(const bad of ['aiff','../wav',null,{}])assert.throws(()=>Export.format(bad),/Choose/);
});
// Independent minimal SMF reader: validates chunks, delta times, channel payloads and termination.
function readMidi(b){
 assert.equal(b.toString('ascii',0,4),'MThd');assert.equal(b.readUInt32BE(4),6);assert.equal(b.readUInt16BE(8),1);
 const count=b.readUInt16BE(10),ppq=b.readUInt16BE(12),tracks=[];let p=14;
 const vlq=()=>{let n=0,k=0,v;do{v=b[p++];assert.ok(++k<=4);n=n*128+(v&127)}while(v&128);return n};
 for(let t=0;t<count;t++){
  assert.equal(b.toString('ascii',p,p+4),'MTrk');const end=p+8+b.readUInt32BE(p+4);p+=8;let time=0,ended=false;const events=[];
  while(p<end){time+=vlq();const status=b[p++];assert.ok(status>=128);
   if(status===255){const type=b[p++],len=vlq(),data=b.subarray(p,p+len);p+=len;if(type===47){assert.equal(len,0);ended=true}events.push({time,status,type,data});}
   else{const size=[0xc0,0xd0].includes(status&240)?1:2,data=[...b.subarray(p,p+size)];p+=size;assert.ok(data.every(v=>v<128));events.push({time,status,data});}
  }assert.equal(p,end);assert.ok(ended);tracks.push(events);
 }assert.equal(p,b.length);return {tracks,ppq};
}
test('MIDI preserves independent voices, note timing, pitch bend and note-off ordering',()=>{
 const note={voice:0,start:.5,end:1,note:69,srcn:5,velocity:90,pan:64,bends:[{time:.5,semitones:0},{time:.75,semitones:1}]};
 const r=readMidi(Midi.encode([note,{...note,voice:1,note:60},{...note,start:1,end:1.5,bends:[{time:1,semitones:0}]}],2));
 assert.equal(r.ppq,480);assert.equal(r.tracks.length,9);
 const voice=r.tracks[1],ons=voice.filter(e=>e.status===0x90),offs=voice.filter(e=>e.status===0x80);
 assert.deepEqual(ons.map(e=>e.time),[480,960]);assert.deepEqual(offs.map(e=>e.time),[960,1440]);
 assert.ok(voice.indexOf(offs[0])<voice.indexOf(ons[1]));assert.equal(r.tracks[2].find(e=>e.status===0x91).data[0],60);
 assert.ok(voice.some(e=>e.status===0xe0&&e.time===720&&e.data[1]>64));
 assert.throws(()=>Midi.vlq(-1),/Invalid/);
});
test('sample tuning estimates a known sine and rejects silence',()=>{
 const pcm=Int16Array.from({length:4096},(_,i)=>10000*Math.sin(2*Math.PI*440*i/32000));
 assert.ok(Math.abs(Midi.fundamental(pcm)-440)<2);assert.equal(Midi.fundamental(new Int16Array(4096)),null);
});
test('SPC MIDI trace observes synthetic key-on and key-off commands',async()=>{
 const aram=Buffer.alloc(65536),dsp=Buffer.alloc(128);let code=[];
 const write=(r,v)=>code.push(0x8f,r,0xf2,0x8f,v,0xf3);
 write(0,100);write(1,100);write(2,0);write(3,16);write(4,0);write(0x5d,0x20);write(0x4c,1);
 code.push(...Array(1200).fill(0));write(0x5c,1);code.push(0xef);
 aram.set(code,0x500);aram[0x2000]=0;aram[0x2001]=0x30;aram[0x3000]=3; // looped, silent sample; C4 fallback
 const spc=buildSpc({aram,dsp,regs:{pc:0x500,a:0,x:0,y:0,psw:0,sp:0xef}},{seconds:1});
 const result=await Midi.trace(spc,.1);assert.equal(result.notes.length,1);assert.equal(result.notes[0].note,60);
 assert.ok(result.notes[0].end>result.notes[0].start);assert.ok(result.notes[0].end<.01);assert.equal(result.approximate,1);
 const encoded=await Midi.fromAudioState({spc},.1,'Synthetic test');readMidi(encoded.bytes);
 assert.equal(await Midi.fromAudioState({spc,baselineSpc:spc},.1,'Unchanged baseline'),null);
 assert.equal(await Midi.fromAudioState({},1,'Raw sample'),null);
});
module.exports={readMidi};

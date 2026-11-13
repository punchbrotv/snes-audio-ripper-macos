const {test}=require('node:test'),assert=require('node:assert/strict');
const I=require('../app/instrument-names'),L=require('../app/logic'),Names=require('../app/track-names');
const sample={id:'a',srcn:3,pcm:Int16Array.from([500,-500,300,-300]),loop:true,loopStart:0,adsr1:254,adsr2:106,gain:184};
const note={voice:0,srcn:3,instrument:'a',start:0,end:1,note:60,velocity:100,pan:64,bends:[{time:0,semitones:0}]};
test('instrument labels follow sample content and loops, not slots or envelope IDs',()=>{
 const entry={sampleSha256:I.fingerprint(sample),name:'Warm Strings',source:'User instrument notes'};
 const moved={...sample,id:'b',srcn:9,adsr1:200};
 assert.equal(I.describe(moved,[note],[entry]).name,'Warm Strings');
 assert.equal(I.describe({...sample,pcm:Int16Array.from([501,-500,300,-300])},[note],[entry]).identification,'unidentified sample');
 assert.equal(I.describe({...sample,loopStart:1},[note],[entry]).identification,'unidentified sample');
 const data={samples:[sample,moved],notes:[note,{...note,instrument:'b',srcn:9,start:2,end:3,bends:[{time:2,semitones:0}]}]};
 const plain=L.prepare(data),named=L.prepare(data,{instruments:[entry]});
 assert.deepEqual(named.samples,plain.samples);
 assert.deepEqual(named.tracks.map(g=>g.notes),plain.tracks.map(g=>g.notes));
 assert.deepEqual(named.tracks.map(g=>g.name),['Warm Strings - V1 S3','Warm Strings - V1 S9']);
 assert.match(I.guide(named.tracks),/User instrument notes/);
 assert.match(I.guide(named.tracks),/ADSR1 FE/);
});
test('different envelope states stay separate and uniquely named; DSP noise is not labeled as a sampled instrument',()=>{
 const other={...sample,id:'b',adsr1:220},entry={sampleSha256:I.fingerprint(sample),name:'Bell'};
 const spec=L.prepare({samples:[sample,other],notes:[note,{...note,instrument:'b'}]},{instruments:[entry]});
 assert.deepEqual(spec.tracks.map(g=>g.name),['Bell - V1 S3','Bell - V1 S3 (2)']);
 assert.equal(I.describe(sample,[{...note,noise:true}],[entry]).name,'Noise');
 assert.equal(I.describe(sample,[note]).name,'Looped Sample');
 assert.equal(I.describe({...sample,loop:false},[note]).name,'One-shot Sample');
});
test('imported profiles round-trip instrument metadata and reject ambiguous or unsafe names',()=>{
 const entry={sampleSha256:I.fingerprint(sample),name:'Bell',source:'Local identification'};
 const profile={version:1,romSha256:'a'.repeat(64),tracks:[],instruments:[entry]};
 assert.deepEqual(Names.validate(profile),profile);
 assert.throws(()=>Names.validate({...profile,instruments:[entry,entry]}),/Duplicate/);
 for(const bad of [{...entry,sampleSha256:'3'},{...entry,name:'bad\nname'},{...entry,name:'x'.repeat(65)},{...entry,source:'bad\nsource'}])
  assert.throws(()=>I.validate([bad]));
});

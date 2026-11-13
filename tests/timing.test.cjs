const {test}=require('node:test'),assert=require('node:assert/strict');
const Timing=require('../app/timing'),Names=require('../app/track-names');
test('tempo maps preserve elapsed time across changes and trim only specified startup silence',()=>{
 const timing=Timing.validate({originSeconds:.25,tempo:[{time:0,bpm:150},{time:1.25,bpm:90}],meter:[3,4]});
 const clock=Timing.clock(timing);
 assert.equal(clock.toTick(.25),0);assert.equal(clock.toTick(1.25),2400);assert.equal(clock.toTick(2.25),3840);
 assert.deepEqual(clock.tempo,[{tick:0,bpm:150},{tick:2400,bpm:90}]);
 assert.equal(Timing.clock(timing,480).toTick(2.25),1920);
 assert.throws(()=>Timing.resolve([{start:.1}],timing),/remove/);
 assert.throws(()=>Timing.validate({tempo:[{time:1,bpm:120}]}),/zero|time 0/);
 assert.throws(()=>Timing.validate({tempo:[{time:0,bpm:NaN}]}));
 assert.throws(()=>Timing.validate({tempo:[{time:0,bpm:120},{time:0,bpm:90}]}));
 const profile=Names.validate({version:1,romSha256:'a'.repeat(64),tracks:[{kind:'Music',label:'command 4',title:'Example',timing}]});
 assert.deepEqual(Names.timingFor(profile,'Music','command 4'),timing);
});
test('periodic notes receive an estimated grid, sparse events keep an explicitly unresolved timebase',()=>{
 const notes=[];for(let i=0;i<120;i++)for(let v=0;v<2;v++)notes.push({voice:v,start:.05+i*60/137+v*.015});
 const result=Timing.resolve(notes);
 assert.equal(result.source,'estimated');assert.ok(Math.abs(result.tempo[0].bpm-137)<.01);assert.equal(result.originSeconds,.05);
 assert.equal(Timing.resolve([{voice:0,start:.03}]).source,'unresolved');
 assert.equal(Timing.resolve(notes,null,false).source,'unresolved');
 // A later tempo change must not be misrepresented by a confident constant grid.
 const varying=notes.map(n=>({...n,start:n.start<20?n.start:20+(n.start-20)*1.17}));
 assert.equal(Timing.resolve(varying).source,'unresolved');
});
test('source beat anchors remove dispatch jitter without erasing written triplets or echo offsets',()=>{
 const timing={originSeconds:.05,tempo:[{time:0,bpm:120}],beatAnchors:[[.05,0],[.56,1],[.58,1+1/24],[.82,1.5],[.987,1+5/6],[1.067,2]]};
 const c=Timing.clock(timing);
 assert.deepEqual(timing.beatAnchors.map(p=>c.toTick(p[0])),[0,960,1000,1440,1760,1920]);
 assert.equal(c.toTick((.82+.987)/2),1600);
 assert.equal(c.toTick(1.567),2880);
 assert.deepEqual(c.tempo,[{tick:0,bpm:120}]);
 assert.equal(Timing.clock(Timing.validate(timing),480).toTick(.82),720);
 assert.throws(()=>Timing.validate({...timing,beatAnchors:[[.05,0],[.04,1]]}),/increase/);
 assert.throws(()=>Timing.validate({...timing,beatAnchors:[[.05,0],[.56,0]]}),/increase/);
 assert.throws(()=>Timing.validate({...timing,beatAnchors:[[.04,0],[.56,1]]}),/origin/);
});

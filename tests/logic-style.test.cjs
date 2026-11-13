const {test}=require('node:test'),assert=require('node:assert/strict');
const {iconFor,rainbow}=require('../app/logic-style');
test('instrument descriptions choose appropriate native artwork and unidentified samples retain a sampler icon',()=>{
 for(const [name,id] of [['Warm Strings',491],['Acoustic Bass',472],['Bass Drum',424],['Cello',490],['Steel Guitar',476],['Glockenspiel',232],['Electric Piano / Harp',485],['Flute',499],['Noise',454],['Looped Sample',502]])assert.equal(iconFor(name).iconId,id,name);
});
test('rainbow uses distinct explicit swatches through Logic’s 96-color palette',()=>{
 for(let count=1;count<=96;count++){
  const colors=rainbow(count);assert.equal(colors.length,count);assert.equal(new Set(colors).size,count);
  assert.ok(colors.every(c=>c>=1&&c<=96));
  const hues=colors.map(c=>(c-1)%24);assert.deepEqual(hues,[...hues].sort((a,b)=>a-b));
 }
 assert.deepEqual(rainbow(256).slice(0,96),rainbow(96));assert.deepEqual(rainbow(0),[]);
 assert.throws(()=>rainbow(257));
});

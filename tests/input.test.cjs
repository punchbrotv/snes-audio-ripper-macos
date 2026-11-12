const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),{execFileSync}=require('child_process');
const {loadInput}=require('../app/input');
const {buildSpc}=require('../app/spc');
function fixture(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'snes-test-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
test('loads raw ROM and ZIP identically, including spaces and Unicode',t=>{
 const dir=fixture(t),name='Test # é.sfc',bytes=Buffer.alloc(32768,42),file=path.join(dir,name);
 fs.writeFileSync(file,bytes);const zip=path.join(dir,'Game.zip');execFileSync('/usr/bin/zip',['-q',zip,name],{cwd:dir});
 const raw=loadInput([file]),arch=loadInput([zip]);assert.deepEqual(raw.rom,arch.rom);assert.equal(arch.name,'Test # é');assert.equal(arch.parts,1);
});
test('rejects ambiguous archives and invalid input before emulation',t=>{
 const dir=fixture(t);for(const name of ['a.sfc','b.smc'])fs.writeFileSync(path.join(dir,name),Buffer.alloc(32768));
 const zip=path.join(dir,'two.zip');execFileSync('/usr/bin/zip',['-q',zip,'a.sfc','b.smc'],{cwd:dir});
 assert.throws(()=>loadInput([zip]),/exactly one/);assert.throws(()=>loadInput([]),/Choose/);
 fs.writeFileSync(path.join(dir,'small.sfc'),'bad');assert.throws(()=>loadInput([path.join(dir,'small.sfc')]),/32 KB/);
});
test('joins split ROM parts numerically',t=>{
 const dir=fixture(t);fs.writeFileSync(path.join(dir,'game.sfc.002'),Buffer.alloc(32768,2));fs.writeFileSync(path.join(dir,'game.sfc.001'),Buffer.alloc(32768,1));
 const r=loadInput([path.join(dir,'game.sfc.002')]);assert.equal(r.parts,2);assert.equal(r.rom[0],1);assert.equal(r.rom[32768],2);assert.equal(r.name,'game');
});
test('SPC preserves explicit command ports for music and SFX',()=>{
 const snap={aram:Buffer.alloc(65536),dsp:Buffer.alloc(128),regs:{pc:0x500,a:0,x:0,y:0,psw:0,sp:0xef}};
 const b=buildSpc(snap,{ports:[1,2,3,4],seconds:60});assert.deepEqual([...b.subarray(0x1f4,0x1f8)],[1,2,3,4]);assert.equal(b.readUInt16LE(0x25),0x500);
 assert.throws(()=>buildSpc(snap,{ports:[999]}),/Invalid/);
});

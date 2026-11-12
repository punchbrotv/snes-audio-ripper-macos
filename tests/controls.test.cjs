const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
test('Stop invokes playback stop when idle and cancellation while extracting',()=>{
 const html=fs.readFileSync(require('path').join(__dirname,'../app/index.html'),'utf8');
 const handler=html.match(/\$\('bStop'\)\.onclick=([^;]+);/)[1];
 for(const busy of [false,true]) {
   let stopped=0,cancelled=0;
   const callback=vm.runInNewContext(handler,{busy,api:{cancel:()=>cancelled++},stopAudio:()=>stopped++});
   callback();assert.equal(stopped,busy?0:1);assert.equal(cancelled,busy?1:0);
 }
});

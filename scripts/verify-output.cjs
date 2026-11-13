'use strict';
// Decode every WAV/MP3 in an export directory; no title-specific data or manifests.
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const dir=path.resolve(process.argv[2]);
function tracks(at){return fs.readdirSync(at,{withFileTypes:true}).flatMap(e=>{
 const p=path.join(at,e.name);return e.isDirectory()?tracks(p):e.isFile()&&/\.(mp3|wav)$/i.test(e.name)?[p]:[];
});}
const files=tracks(dir);if(!files.length)throw Error('No WAV or MP3 files in export');
let durationSeconds=0,minPeak=1,peak=0,clipped=0,samples=0;
for(const file of files){
 const pcm=execFileSync(process.env.FFMPEG||'ffmpeg',['-v','error','-i',file,'-ar','48000','-ac','2','-f','s16le','-acodec','pcm_s16le','-'],{maxBuffer:100*1024*1024});
 if(!pcm.length)throw Error('Empty decode: '+file);
 let localPeak=0;
 for(let i=0;i<pcm.length;i+=2){const a=Math.abs(pcm.readInt16LE(i));localPeak=Math.max(localPeak,a);if(a>=32760)clipped++;samples++;}
 if(localPeak===0)throw Error('Silent output: '+file);
 minPeak=Math.min(minPeak,localPeak/32768);peak=Math.max(peak,localPeak/32768);durationSeconds+=pcm.length/4/48000;
}
const result={files:files.length,durationSeconds,minimumPeakDBFS:20*Math.log10(minPeak),maximumPeakDBFS:20*Math.log10(peak),clippedSampleFraction:clipped/samples};
fs.writeFileSync(path.join(dir,'validation.json'),JSON.stringify(result,null,2));console.log(result);

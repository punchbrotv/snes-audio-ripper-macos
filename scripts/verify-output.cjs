const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const dir=path.resolve(process.argv[2]),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
let duration=0,minPeak=1,peak=0,clipped=0,samples=0;
for(const track of manifest.tracks){
 const file=path.join(dir,track.file);
 const pcm=execFileSync(process.env.FFMPEG || 'ffmpeg',['-v','error','-i',file,'-f','s16le','-acodec','pcm_s16le','-'],{maxBuffer:100*1024*1024});
 if(!pcm.length)throw Error('Empty decode: '+track.file);
 let localPeak=0;
 for(let i=0;i<pcm.length;i+=2){const a=Math.abs(pcm.readInt16LE(i));localPeak=Math.max(localPeak,a);if(a>=32760)clipped++;samples++;}
 if(localPeak<100)throw Error('Silent output: '+track.file);
 minPeak=Math.min(minPeak,localPeak/32768);peak=Math.max(peak,localPeak/32768);duration+=track.seconds;
 if(Math.abs(pcm.length/4/48000-track.seconds)>0.2)throw Error('Unexpected duration: '+track.file);
}
const result={files:manifest.tracks.length,music:manifest.music,sfx:manifest.sfx,durationSeconds:duration,minimumPeakDBFS:20*Math.log10(minPeak),maximumPeakDBFS:20*Math.log10(peak),clippedSampleFraction:clipped/samples};
fs.writeFileSync(path.join(dir,'validation.json'),JSON.stringify(result,null,2));console.log(result);

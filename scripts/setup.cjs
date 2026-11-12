'use strict';
const fs=require('fs'),path=require('path');
const {execFileSync:run}=require('child_process');
const {download}=require('./download.cjs'),{applyPort}=require('./apply-port.cjs'),{buildCore}=require('./build-core.cjs');
const root=path.resolve(__dirname,'..'),app=path.join(root,'app');
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Setup requires an Apple Silicon Mac.');
if(fs.existsSync(app))throw Error('app/ already exists; setup will not overwrite local edits. Use a fresh checkout to regenerate the application.');
const archive=download('https://github.com/Samsqwamch/SNES_Audio_Ripper/releases/download/v1.0.0/SNES.Audio.Ripper.exe',path.join(root,'upstream/SNES.Audio.Ripper.exe'),'3304e159490baaacfb77408d20c555d6fc938a895aee811b38af604215283820');
fs.mkdirSync(path.join(root,'build'),{recursive:true});const staging=fs.mkdtempSync(path.join(root,'build/setup-'));
try {
  const extracted=path.join(staging,'windows'),prepared=path.join(staging,'app');fs.mkdirSync(extracted);
  // The verified installer is read as an archive. No Windows executable is run.
  run(process.env.BSDTAR||'/usr/bin/tar',['-xf',archive,'-C',extracted,'resources/app.asar','resources/app.asar.unpacked'],{stdio:'inherit'});
  run(process.execPath,[path.join(root,'scripts/unpack-asar.cjs'),path.join(extracted,'resources/app.asar'),prepared],{stdio:'inherit'});
  applyPort(prepared);
  buildCore(prepared);
  fs.renameSync(prepared,app);
  console.log('Prepared macOS application. Next: npm test && npm run build');
} finally {fs.rmSync(staging,{recursive:true,force:true});}

'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
const {execFileSync:run}=require('child_process');
const {download}=require('./download.cjs');
const COMMIT='fae2fea08f74180759ef540ee94259213f503480';
const SOURCE_SHA='0d4b0c4181d66668ec0040eb17f90a559f7b7fa6cbd9198593c3bdbe79acd029';
function buildCore(appDir=path.resolve(__dirname,'../app')) {
  if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('The supported build host is Apple Silicon macOS.');
  const root=path.resolve(__dirname,'..'),source=path.join(root,'build/snes9x-'+COMMIT);
  const archive=download('https://codeload.github.com/libretro/snes9x/tar.gz/'+COMMIT,path.join(root,'upstream/snes9x-'+COMMIT+'.tar.gz'),SOURCE_SHA);
  if(!fs.existsSync(path.join(source,'libretro/Makefile'))){fs.mkdirSync(source,{recursive:true});run('/usr/bin/tar',['-xzf',archive,'-C',source,'--strip-components=1'],{stdio:'inherit'});}
  run('/usr/bin/make',['-C',path.join(source,'libretro'),'-j'+Math.min(os.cpus().length,8),'platform=osx','arch=arm','CC=clang','CXX=clang++','GIT_VERSION=" fae2fea"'],{stdio:'inherit',env:{...process.env,MACOSX_DEPLOYMENT_TARGET:'13.0'}});
  fs.mkdirSync(path.join(appDir,'cores'),{recursive:true});
  fs.copyFileSync(path.join(source,'libretro/snes9x_libretro.dylib'),path.join(appDir,'cores/snes9x_libretro.dylib'));
  fs.mkdirSync(path.join(appDir,'licenses'),{recursive:true});fs.copyFileSync(path.join(source,'LICENSE'),path.join(appDir,'licenses/Snes9x.txt'));
}
if(require.main===module)buildCore();
module.exports={buildCore};

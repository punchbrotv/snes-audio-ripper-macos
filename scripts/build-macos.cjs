'use strict';
const fs=require('fs'),path=require('path'),{execFileSync:run}=require('child_process');
const root=path.resolve(__dirname,'..'),dest=path.join(root,'dist','SNES Audio Ripper.app');
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('This build targets Apple Silicon macOS.');
const electron=path.join(root,'node_modules/electron/dist/Electron.app');
if(!fs.existsSync(electron))throw Error('Run npm ci, then ELECTRON_CACHE="$PWD/.electron-cache" node node_modules/electron/install.js');
if(!fs.existsSync(path.join(root,'app/cores/snes9x_libretro.dylib')))throw Error('Native Snes9x core missing.');
if(!fs.existsSync(path.join(root,'app/helpers/logic-writer/logic-writer')))throw Error('Logic exporter missing. Run npm run setup.');
fs.mkdirSync(path.dirname(dest),{recursive:true});
fs.rmSync(dest,{recursive:true,force:true});
run('/usr/bin/ditto',[electron,dest]);
const contents=path.join(dest,'Contents'),resources=path.join(contents,'Resources');
fs.rmSync(path.join(resources,'default_app.asar'),{force:true});
fs.cpSync(path.join(root,'app'),path.join(resources,'app'),{recursive:true,verbatimSymlinks:true,filter:src=>{
  const relative=path.relative(path.join(root,'app'),src);
  if(relative==='cores'||relative==='after-pack.js'||relative==='README.md')return false;
  if(relative.startsWith('node_modules/koffi/build/koffi/'))return relative.split('/')[4]==='darwin_arm64';
  if(/^node_modules\/koffi\/(src|vendor|doc)(\/|$)/.test(relative))return false;
  return true;
}});
fs.cpSync(path.join(root,'app/cores'),path.join(resources,'cores'),{recursive:true});
fs.copyFileSync(path.join(root,'LICENSE'),path.join(resources,'PORT-LICENSE.txt'));
for(const name of ['LICENSE','LICENSES.chromium.html'])fs.copyFileSync(path.join(root,'node_modules/electron/dist',name),path.join(resources,name));
if(fs.existsSync(path.join(root,'CREDITS.md')))fs.copyFileSync(path.join(root,'CREDITS.md'),path.join(resources,'CREDITS.md'));
if(fs.existsSync(path.join(root,'THIRD_PARTY_NOTICES.md')))fs.copyFileSync(path.join(root,'THIRD_PARTY_NOTICES.md'),path.join(resources,'THIRD_PARTY_NOTICES.md'));
const version=require('../app/package.json').version.split('-')[0];
const plist=path.join(contents,'Info.plist');
const edits={CFBundleDisplayName:'SNES Audio Ripper',CFBundleName:'SNES Audio Ripper',CFBundleIdentifier:'local.snes-audio-ripper.macos',CFBundleShortVersionString:version,CFBundleVersion:version,NSHumanReadableCopyright:'Original Windows application: Samsqwamch. macOS port: PunchBro, built with Codex by OpenAI.'};
run('/usr/bin/python3',['-c', `import plistlib,json,sys
p=sys.argv[1]
with open(p,'rb') as f: d=plistlib.load(f)
d.update(json.loads(sys.argv[2]))
d['CFBundleDocumentTypes']=[{'CFBundleTypeName':'SNES ROM','CFBundleTypeRole':'Viewer','LSHandlerRank':'Alternate','CFBundleTypeExtensions':['sfc','smc','swc','fig','zip']}]
with open(p,'wb') as f: plistlib.dump(d,f)`,plist,JSON.stringify(edits)]);
const png=fs.readFileSync(path.join(root,'app/icon.png'));
const iconHeader=Buffer.alloc(16);iconHeader.write('icns');iconHeader.writeUInt32BE(png.length+16,4);iconHeader.write('ic08',8);iconHeader.writeUInt32BE(png.length+8,12);
fs.writeFileSync(path.join(resources,'electron.icns'),Buffer.concat([iconHeader,png]));
run('/usr/bin/codesign',['--force','--deep','--sign','-',dest],{stdio:'inherit'});
run('/usr/bin/codesign',['--verify','--deep','--strict',dest],{stdio:'inherit'});
console.log(dest);

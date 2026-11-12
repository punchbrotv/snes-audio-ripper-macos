'use strict';
// Source is checked into app/. Setup installs dependencies; it never retrieves the Windows app.
const fs=require('fs'),path=require('path');
const {execFileSync:run}=require('child_process');
const {buildCore}=require('./build-core.cjs');
const root=path.resolve(__dirname,'..'),app=path.join(root,'app');
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Setup requires an Apple Silicon Mac.');
const installer=path.join(root,'node_modules/electron/install.js');
if(!fs.existsSync(installer))throw Error('Run npm ci in the repository first.');
run(process.execPath,[installer],{stdio:'inherit'});
const npm=process.env.npm_execpath;
if(npm)run(process.execPath,[npm,'ci','--prefix',app],{stdio:'inherit'});
else run('npm',['ci','--prefix',app],{stdio:'inherit'});
buildCore(app);
console.log('Dependencies ready. Next: npm test && npm run build');

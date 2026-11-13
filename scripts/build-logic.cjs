'use strict';
const fs=require('fs'),path=require('path'),{execFileSync:run}=require('child_process');
const {download}=require('./download.cjs');
const root=path.resolve(__dirname,'..'),venv=path.join(root,'build/logic-python-portable'),py=path.join(venv,'bin/python');
function buildLogic(){
  if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('The supported build host is Apple Silicon macOS.');
  // A pinned portable runtime keeps deployment targets independent of Homebrew/the host OS.
  const base=path.join(root,'build/python-portable');
  const archive=download('https://github.com/astral-sh/python-build-standalone/releases/download/20261110/cpython-3.12.16%2B20261110-aarch64-apple-darwin-install_only.tar.gz',path.join(root,'build/python-portable.tar.gz'),'e956e60bc9465d577ef8062059aa05cd3a2665b4b8678a2ed24e432368330b8f');
  if(!fs.existsSync(path.join(base,'python/bin/python3'))){fs.mkdirSync(base,{recursive:true});run('/usr/bin/tar',['-xzf',archive,'-C',base],{stdio:'inherit'});}
  if(!fs.existsSync(py))run(path.join(base,'python/bin/python3'),['-m','venv',venv],{stdio:'inherit'});
  run(py,['-m','pip','install','--disable-pip-version-check','-r',path.join(root,'scripts/logic-build-requirements.txt')],{stdio:'inherit'});
  run(py,['-m','PyInstaller','--noconfirm','--clean','--onedir','--name','logic-writer','--paths',path.join(root,'vendor'),'--add-data',path.join(root,'vendor/logicx/data')+':logicx/data','--distpath',path.join(root,'app/helpers'),'--workpath',path.join(root,'build/logic-pyinstaller'),'--specpath',path.join(root,'build'),path.join(root,'scripts/logic-writer.py')],{stdio:'inherit',env:{...process.env,PYINSTALLER_CONFIG_DIR:path.join(root,'build/pyinstaller-cache')}});
  fs.copyFileSync(path.join(base,'python/lib/python3.12/LICENSE.txt'),path.join(root,'app/licenses/Python.txt'));
  fs.copyFileSync(path.join(venv,'lib/python3.12/site-packages/pyinstaller-6.16.0.dist-info/licenses/COPYING.txt'),path.join(root,'app/licenses/PyInstaller.txt'));
  fs.copyFileSync(path.join(root,'vendor/logicx/LICENSE'),path.join(root,'app/licenses/LogicProFormatWriter.txt'));
}
module.exports={buildLogic};if(require.main===module)buildLogic();

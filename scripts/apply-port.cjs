'use strict';
const fs = require('fs'), path = require('path');
const {sha256} = require('./download.cjs');
function applyPort(appDir) {
  const root=path.resolve(__dirname,'..');
  const recipe=JSON.parse(fs.readFileSync(path.join(root,'port/edits.json'),'utf8'));
  const originals=new Map();
  // Snapshot original bytes before any files change (derived modules can refer to them).
  for(const name of new Set([...Object.keys(recipe.files),...Object.values(recipe.derivedFiles).flatMap(f=>f.pieces.filter(p=>p.source).map(p=>p.source))])) originals.set(name,fs.readFileSync(path.join(appDir,name)));
  for(const [name,spec] of Object.entries(recipe.files)) {
    const original=originals.get(name);
    if(sha256(original)!==spec.sourceSHA256)throw Error('Unexpected upstream file: '+name);
    const parts=[];let cursor=0;
    for(const edit of spec.edits){if(edit.start<cursor||edit.end<edit.start||edit.end>original.length)throw Error('Invalid edit range');parts.push(original.subarray(cursor,edit.start),Buffer.from(edit.text));cursor=edit.end;}
    parts.push(original.subarray(cursor));const result=Buffer.concat(parts);
    if(sha256(result)!==spec.resultSHA256)throw Error('Port result checksum mismatch: '+name);
    fs.writeFileSync(path.join(appDir,name),result);
  }
  for(const [name,spec]of Object.entries(recipe.derivedFiles)){
    const result=Buffer.concat(spec.pieces.map(p=>p.source?originals.get(p.source).subarray(p.start,p.end):Buffer.from(p.text)));
    if(sha256(result)!==spec.resultSHA256)throw Error('Derived result checksum mismatch: '+name);
    fs.writeFileSync(path.join(appDir,name),result);
  }
  fs.cpSync(path.join(root,'port/new-files'),appDir,{recursive:true});
}
module.exports={applyPort};

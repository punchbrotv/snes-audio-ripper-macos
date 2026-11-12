'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const {execFileSync} = require('child_process');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
function download(url, file, expected) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  if (!fs.existsSync(file)) {
    const partial = file + '.partial';
    execFileSync('/usr/bin/curl', ['--fail','--location','--retry','2','--connect-timeout','30','--max-time','300',url,'--output',partial], {stdio:'inherit'});
    if (sha256(fs.readFileSync(partial)) !== expected) {fs.unlinkSync(partial);throw Error('Download checksum mismatch: ' + url);}
    fs.renameSync(partial, file);
  }
  if (sha256(fs.readFileSync(file)) !== expected) throw Error('Cached download checksum mismatch: ' + file);
  return file;
}
module.exports = {download, sha256};

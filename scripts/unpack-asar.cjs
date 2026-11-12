const fs = require('fs'), path = require('path');
const data = fs.readFileSync(process.argv[2]);
const header = JSON.parse(data.subarray(16, 16 + data.readUInt32LE(12)));
const base = 8 + data.readUInt32LE(4);
function walk(files, dir, relative = '') {
  fs.mkdirSync(dir, {recursive:true});
  for (const [name, entry] of Object.entries(files)) {
    if (name === '..' || name.includes('/') || name.includes('\\')) throw Error('Unsafe archive path');
    const dest = path.join(dir, name), rel = path.join(relative, name);
    if (entry.files) walk(entry.files, dest, rel);
    else if (entry.unpacked) fs.copyFileSync(process.argv[2] + '.unpacked/' + rel, dest);
    else fs.writeFileSync(dest, data.subarray(base + Number(entry.offset), base + Number(entry.offset) + entry.size));
  }
}
walk(header.files, process.argv[3]);

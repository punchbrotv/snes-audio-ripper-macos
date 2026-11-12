const fs = require('fs'), path = require('path');
const SPLIT = /(\.\d{3}$)|([ _.(\[-]*(part|pt)[ _-]?\d+\)?)|(\s*\(\d+ of \d+\))|(\.(sfc|smc|swc|fig)\.[a-d]$)/i;
function gatherParts(paths) {
  let files = [...paths];
  if (files.length === 1) {
    const base = path.basename(files[0]);
    const key = base.replace(SPLIT, '#');
    if (key !== base) {
      const dir = path.dirname(files[0]);
      files = fs.readdirSync(dir).filter(f => f.replace(SPLIT, '#') === key).map(f => path.join(dir, f));
    }
  }
  files.sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
  return files;
}

module.exports = {gatherParts};

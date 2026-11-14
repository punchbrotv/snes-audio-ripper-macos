const { parentPort, workerData } = require('worker_threads');
const { ripRom } = require('./rip');
ripRom(workerData.paths, workerData.output, p => parentPort.postMessage({progress:p}), workerData.cache, { format: workerData.format, includeSfx: workerData.includeSfx === true })
  .then(result => parentPort.postMessage({result}))
  .catch(e => parentPort.postMessage({result:{ok:false,error:e.message}}))
  .finally(() => { require('./render').shutdown(); parentPort.close(); });

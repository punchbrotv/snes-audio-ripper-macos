const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const { Worker } = require('worker_threads');
const path = require('path');
let win, job = null, lastOutput = null, output;
const queued = [];
function sendOpen(paths) {
  if (!win || win.webContents.isLoading()) queued.push(...paths);
  else win.webContents.send('open-files', paths);
}
app.on('open-file', (e, file) => { e.preventDefault(); sendOpen([file]); });
function createWindow() {
  win = new BrowserWindow({width:560,height:490,resizable:false,backgroundColor:'#1b1b26',titleBarStyle:'hiddenInset',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.loadFile(path.join(__dirname,'index.html'));
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.once('did-finish-load', () => { if (queued.length) sendOpen(queued.splice(0)); });
  win.on('close', e => {
    if (job && dialog.showMessageBoxSync(win,{type:'question',message:'Stop the current extraction?',detail:'Completed files will remain in the output folder.',buttons:['Keep extracting','Stop and close'],defaultId:0,cancelId:0})===0) e.preventDefault();
    else if(job) job.terminate();
  });
}
app.whenReady().then(() => {
  output = app.getPath('desktop');
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:app.name,submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},
    {label:'File',submenu:[{label:'Open ROM…',accelerator:'CmdOrCtrl+O',click:()=>win.webContents.send('browse')},{label:'Choose Output Folder…',click:pickOutput},{label:'Import Track Names…',click:importTrackNames},{type:'separator'},{role:'close'}]},
    {role:'editMenu'},{role:'windowMenu'}
  ]));
  createWindow();
});
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
app.on('window-all-closed', () => app.quit());
async function pickOutput() {
  if(job) return;
  const r = await dialog.showOpenDialog(win,{title:'Choose extraction destination',defaultPath:output,properties:['openDirectory','createDirectory']});
  if(!r.canceled) output=r.filePaths[0];
}
async function importTrackNames() {
  if (job) return;
  const r = await dialog.showOpenDialog(win, {title:'Import track-name profile',properties:['openFile'],filters:[{name:'Track names',extensions:['json']}]});
  if (r.canceled) return;
  try {
    const profile = require('./track-names').install(r.filePaths[0], app.getPath('userData'));
    await dialog.showMessageBox(win, {type:'info',message:`Imported ${profile.tracks.length} track names`,detail:'These names will be used for future exports of the matching ROM, in every format.'});
  } catch (e) { await dialog.showMessageBox(win, {type:'error',message:'Could not import track names',detail:e.message}); }
}
ipcMain.handle('pick', async () => {
  const r=await dialog.showOpenDialog(win,{properties:['openFile','multiSelections'],filters:[{name:'SNES ROM or ZIP',extensions:['sfc','smc','swc','fig','bin','zip','001','002','003','a','b']}]});
  return r.canceled?[]:r.filePaths;
});
ipcMain.handle('rip', (e, paths, selected = 'mp3') => {
  if(job) return {ok:false,error:'An extraction is already running.'};
  try { require('./export').format(selected); } catch (err) { return {ok:false,error:err.message}; }
  if(!Array.isArray(paths)||!paths.length||paths.some(p=>typeof p!=='string')) return {ok:false,error:'Choose a ROM.'};
  return new Promise(resolve => {
    const worker = new Worker(path.join(__dirname,'rip-worker.js'),{workerData:{paths,output,cache:app.getPath('userData'),format:selected}});
    job=worker;
    let finished=false;
    const finish=r=>{if(finished)return;finished=true;if(job===worker)job=null;if(r.ok)lastOutput=r.dir;resolve(r)};
    worker.on('message',m=>{if(m.progress&&!e.sender.isDestroyed())e.sender.send('progress',m.progress);if(m.result)finish(m.result)});
    worker.on('error',err=>finish({ok:false,error:err.message}));
    worker.on('exit',code=>finish({ok:false,cancelled:!!worker.cancelled,error:worker.cancelled?'Extraction stopped. Completed files remain in the output folder.':`Extraction process exited unexpectedly (${code}). See the output Debug log.`}));
  });
});
ipcMain.on('cancel',()=>{if(job){job.cancelled=true;job.terminate()}});
ipcMain.on('win',(_e,a)=>a==='min'?win.minimize():win.close());
ipcMain.on('open',()=>{if(lastOutput)shell.openPath(lastOutput)});

ipcMain.handle('open-midi', async (_e, file) => {
  if (!lastOutput || typeof file !== 'string' || !/^(Music|SFX)\/[^/\\]+\.(mid|logicx)$/.test(file)) return 'Choose an exported MIDI file or Logic project.';
  return shell.openPath(path.join(lastOutput, file));
});

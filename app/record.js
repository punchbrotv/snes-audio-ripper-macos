// Plays the game headless inside the Snes9x libretro core, with a button-pressing bot, and records everything it plays.
// This is the only way to get real music: SNES music is note data run by the game's own sound program, not audio.
const fs = require('fs');
const path = require('path');
const { findSnd } = require('./spc');
const { ripSnapshots } = require('./songs');

const SECONDS = 240;    // seconds of game time to run (about 25 s of real time): enough to load the sound program; snapshots every 15 s
const IN_RATE = 32040;  // SNES DSP output rate
const FPS = 60.0988;
const tick = () => new Promise(r => setImmediate(r));

function findCore() {
  const name = process.platform === 'darwin' ? 'snes9x_libretro.dylib' : process.platform === 'win32' ? 'snes9x_libretro.dll' : 'snes9x_libretro.so';
  const list = [path.join(process.resourcesPath || '', 'cores', name), path.join(__dirname, 'cores', name)];
  return list.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
}

let api = null;
const st = { chunks: [], held: 0, loud: 0 };
const OK_CMDS = new Set([1, 8, 10, 11, 16, 18, 32, 34, 35, 36, 37]); // "SET_*" commands we accept; every "GET_*" is declined

function init(koffi, corePath) {
  if (api) return api;
  const lib = koffi.load(corePath);
  const Env = koffi.proto('bool snes_env(unsigned int cmd, void *data)');
  const Video = koffi.proto('void snes_video(const void *data, unsigned int w, unsigned int h, size_t pitch)');
  const Sample = koffi.proto('void snes_sample(int16_t l, int16_t r)');
  const Batch = koffi.proto('size_t snes_batch(const int16_t *data, size_t frames)');
  const Poll = koffi.proto('void snes_poll(void)');
  const Input = koffi.proto('int16_t snes_input(unsigned int port, unsigned int device, unsigned int index, unsigned int id)');
  koffi.struct('SnesGameInfo', { path: 'const char *', data: 'const void *', size: 'size_t', meta: 'const char *' });
  api = {
    cb: {
      env: koffi.register(cmd => OK_CMDS.has(cmd & 0xffff), koffi.pointer(Env)),
      video: koffi.register(() => {}, koffi.pointer(Video)),
      sample: koffi.register(() => {}, koffi.pointer(Sample)),
      batch: koffi.register((ptr, frames) => Number(frames), koffi.pointer(Batch)),
      poll: koffi.register(() => {}, koffi.pointer(Poll)),
      input: koffi.register((port, dev, idx, id) => (port === 0 && dev === 1 && id < 16 ? (st.held >> id) & 1 : 0), koffi.pointer(Input))
    },
    init: lib.func('void retro_init(void)'),
    deinit: lib.func('void retro_deinit(void)'),
    run: lib.func('void retro_run(void)'),
    serSize: lib.func('size_t retro_serialize_size(void)'),
    ser: lib.func('bool retro_serialize(void *data, size_t size)'),
    load: lib.func('bool retro_load_game(const SnesGameInfo *info)'),
    unload: lib.func('void retro_unload_game(void)'),
    setEnv: lib.func('void retro_set_environment(snes_env *cb)'),
    setVideo: lib.func('void retro_set_video_refresh(snes_video *cb)'),
    setSample: lib.func('void retro_set_audio_sample(snes_sample *cb)'),
    setBatch: lib.func('void retro_set_audio_sample_batch(snes_batch *cb)'),
    setPoll: lib.func('void retro_set_input_poll(snes_poll *cb)'),
    setInput: lib.func('void retro_set_input_state(snes_input *cb)')
  };
  return api;
}

// Button bot: taps START/A early to get past title screens and menus, then wanders (mostly rightwards) and jumps/attacks.
// libretro joypad ids: B0 Y1 SELECT2 START3 UP4 DOWN5 LEFT6 RIGHT7 A8 X9 L10 R11
function makeBot() {
  let f = 0, held = 0, until = 0, next = 30;
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  return () => {
    f++;
    if (f >= until) held = 0;
    if (f >= next) {
      const r = Math.random(); let m = 0, dur = 5;
      if (r < .16) m = 1 << 3;
      else if (r < .38) m = 1 << 8;
      else if (r < .52) m = 1 << 0;
      else if (r < .58) m = (1 << 9) | (1 << 1);
      else {
        const d = Math.random() < .5 ? 7 : [4, 5, 6][rnd(0, 2)];
        m = 1 << d; dur = rnd(20, 90);
        if (Math.random() < .5) m |= 1 << (Math.random() < .6 ? 8 : 0);
      }
      held = m; until = f + dur; next = f + dur + rnd(6, 35);
    }
    let out = held;
    if (f < 3600) { if (f % 180 < 5) out |= 1 << 3; if (f % 90 > 44 && f % 90 < 49) out |= 1 << 8; }
    else { if (f % 900 < 5) out |= 1 << 3; if (f % 300 > 150 && f % 300 < 155) out |= 1 << 8; }
    return out;
  };
}

async function capture(koffi, corePath, rom, romPath, seconds, onPct, log) {
  const a = init(koffi, corePath);
  log('core initialised, functions bound');
  st.held = 0;
  a.setEnv(a.cb.env); a.init();
  a.setVideo(a.cb.video); a.setSample(a.cb.sample); a.setBatch(a.cb.batch); a.setPoll(a.cb.poll); a.setInput(a.cb.input);
  if (!a.load({ path: romPath, data: rom, size: rom.length, meta: null })) { a.deinit(); throw new Error('the emulator rejected this ROM'); }
  const total = Math.round(seconds * FPS);
  log('game loaded, running ' + total + ' frames');
  const bot = makeBot(), snaps = [], size = Number(a.serSize()), buf = Buffer.alloc(size);
  let next = 900;                                        // first snapshot after 15 s, then every 15 s
  try {
    for (let f = 0; f < total; f++) {
      st.held = bot(); a.run();
      if (f >= next) {
        next += 900;
        try {
          if (!a.ser(buf, size)) log('retro_serialize returned false');
          else { const loc = findSnd(buf); if (loc) snaps.push({ frame: f, block: Buffer.from(buf.subarray(loc.off, loc.off + loc.len)) }); else log('SND block not found at frame ' + f); }
        } catch (e) { log('snapshot failed: ' + e.message); }
      }
      if (f % 45 === 0) { onPct(f / total); await tick(); }
    }
  } finally { a.unload(); a.deinit(); }
  log('emulation finished, ' + snaps.length + ' sound-chip snapshots');
  return snaps;
}

async function recordAudio(rom, romPath, dir, emit, log = () => {}) {
  const corePath = findCore();
  log('core path: ' + corePath);
  if (!corePath) throw new Error('core-missing');
  let koffi; try { koffi = require('koffi'); } catch (e) { log('koffi load error: ' + e.message); throw new Error('koffi-missing'); }
  log('koffi loaded');
  emit({ phase: 'record', text: 'RUNNING THE GAME TO LOAD ITS SOUND PROGRAM', pct: 0, local: 0, label: 'RUNNING GAME', sub: 'LOADING THE SOUND PROGRAM INTO THE SOUND CHIP' });
  const snaps = await capture(koffi, corePath, rom, romPath, SECONDS, p => emit({ phase: 'record', pct: p * 0.15, local: p, label: 'RUNNING GAME', sub: 'LOADING THE SOUND PROGRAM INTO THE SOUND CHIP' }), log);
  return ripSnapshots(snaps, dir, emit, log, {}, rom);
}

module.exports = { recordAudio, makeBot };

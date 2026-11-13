'use strict';
const fs = require('fs');
const path = require('path');
const { encode: mp3 } = require('./mp3');
const { encodeWav } = require('./wav');
const FORMATS = ['mp3', 'wav', 'midi'];
function format(value = 'mp3') {
  if (!FORMATS.includes(value)) throw new Error('Choose MP3, WAV, or MIDI.');
  return value;
}
const extension = value => { const selected = format(value); return selected === 'midi' ? 'mid' : selected; };
async function writeAudio(file, channels, rate, selected, bitrate = 160) {
  format(selected);
  if (selected === 'midi') throw new Error('MIDI requires note events, not audio samples.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, selected === 'wav' ? encodeWav(channels, rate) : await mp3(channels, rate, bitrate));
}
module.exports = { format, extension, writeAudio };

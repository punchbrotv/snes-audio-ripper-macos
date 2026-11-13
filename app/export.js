'use strict';
const fs = require('fs');
const path = require('path');
const { encode: mp3 } = require('./mp3');
const { encodeWav } = require('./wav');
const FORMATS = ['mp3', 'wav', 'midi', 'logic'];
function format(value = 'mp3') {
  if (!FORMATS.includes(value)) throw new Error('Choose MP3, WAV, MIDI, or Logic Pro.');
  return value;
}
const extension = value => { const selected = format(value); return selected === 'logic' ? 'logicx' : selected === 'midi' ? 'mid' : selected; };
async function writeAudio(file, channels, rate, selected, bitrate = 160) {
  format(selected);
  if (selected === 'midi' || selected === 'logic') throw new Error('Instrument exports require note events, not audio samples.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, selected === 'wav' ? encodeWav(channels, rate) : await mp3(channels, rate, bitrate));
}
module.exports = { format, extension, writeAudio };

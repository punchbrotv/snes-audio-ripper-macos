"use strict";
// Native Logic artwork IDs, resolved by Logic itself; no artwork is bundled.
// Match descriptions supplied by the local profile, not sample slots or titles.
const families = [
  [/\b(?:glockenspiel|celesta|music box|bells?)\b/i, 232, 'Bells'],
  [/\b(?:marimba|xylophone|vibraphone|mallets?)\b/i, 233, 'Mallets'],
  [/\b(?:steel drums?|steelpan)\b/i, 234, 'Tuned percussion'],
  [/\b(?:bass drum|kick)\b/i, 424, 'Bass drum'],
  [/\bsnare\b/i, 429, 'Snare drum'],
  [/\b(?:cymbals?|hi[ -]?hat)\b/i, 435, 'Cymbals'],
  [/\b(?:shaker|maracas)\b/i, 437, 'Shaker'],
  [/\bbongos?\b/i, 443, 'Bongos'],
  [/\b(?:drums?|percussion)\b/i, 444, 'Percussion'],
  [/\b(?:acoustic bass|upright bass|double bass|contrabass)\b/i, 472, 'Upright bass'],
  [/\b(?:slap bass|electric bass|bass guitar)\b/i, 473, 'Electric bass'],
  [/\bbass\b/i, 545, 'Bass'],
  [/\b(?:distortion|electric|overdriven) guitar\b/i, 479, 'Electric guitar'],
  [/\bguitar\b/i, 476, 'Guitar'],
  [/\b(?:electric piano|e[ -]?piano|rhodes)\b/i, 485, 'Electric piano'],
  [/\bpiano\b/i, 483, 'Piano'],
  [/\borgan\b/i, 486, 'Organ'],
  [/\bcello\b/i, 490, 'Cello'],
  [/\b(?:violin|viola)\b/i, 489, 'Violin / viola'],
  [/\b(?:strings?|orchestra)\b/i, 491, 'Strings'],
  [/\bharp\b/i, 493, 'Harp'],
  [/\btrumpet\b/i, 494, 'Trumpet'],
  [/\btrombone\b/i, 495, 'Trombone'],
  [/\bsax(?:ophone)?\b/i, 496, 'Saxophone'],
  [/\b(?:french horn|horn)\b/i, 497, 'Horn'],
  [/\btuba\b/i, 498, 'Tuba'],
  [/\bflute\b/i, 499, 'Flute'],
  [/\b(?:oboe|clarinet|bassoon|woodwind)\b/i, 500, 'Woodwind'],
  [/\bbrass\b/i, 235, 'Brass'],
  [/\b(?:choir|voice|vocal)\b/i, 199, 'Choir'],
  [/\b(?:noise|sound effect|sfx)\b/i, 454, 'Sound effect'],
  [/\bsynth(?:esizer)?\b/i, 487, 'Synthesizer'],
];
function iconFor(name) {
  const match = families.find(([pattern]) => pattern.test(name || ''));
  return match ? {iconId:match[1], iconDescription:match[2]} : {iconId:502, iconDescription:'Sampler'};
}
// Logic offers 24 hues in four brightness rows. Keep hue increasing from
// red through violet; larger sessions interleave brightnesses at each hue.
function rainbow(count) {
  if (!Number.isInteger(count) || count < 0 || count > 256) throw Error('Invalid Logic track count.');
  const unique = Math.min(count,96);
  const levels = unique <= 24 ? [0] : unique <= 48 ? [0,72] : unique <= 72 ? [24,0,72] : [48,24,0,72];
  const palette = Array.from({length:24},(_,h) => levels.map(level => 1+h+level)).flat();
  return Array.from({length:count},(_,i) => palette[Math.round((i%96)*(palette.length-1)/Math.max(1,unique-1)) % palette.length]);
}
function styleTracks(tracks) {
  const colors = rainbow(tracks.length);
  tracks.forEach((g,i) => {g.style = {...iconFor(g.instrument?.name), colorIndex:colors[i]};});
}
module.exports = {iconFor, rainbow, styleTracks};

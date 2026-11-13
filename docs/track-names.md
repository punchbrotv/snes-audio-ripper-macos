# Give your soundtrack readable names

A ROM tells the sound hardware **which music command to play**. It usually does not store a neat list of song titles. A track-name profile supplies that missing list without changing how the ripper discovers or plays music.

1. Choose **File → Import Track Names…** and select a matching JSON profile.
2. Open your ROM or ZIP and choose any export format.
3. The results keep their track numbers and add titles: `Music Track-15 - Mountain Path.logicx`, for example. Unnamed tracks keep their existing filenames.

Imported profiles stay on your Mac and are reused for future exports. Importing a profile does not rename previously exported files. Alternatively, place `Example Game.tracks.json` next to `Example Game.zip` or `Example Game.sfc`. A matching adjacent profile takes precedence over an imported one.

## Make a profile

Run an export first. Its `manifest.json` supplies the ROM's `romSha256` fingerprint and each track's `kind` and `label`. Copy those fields exactly and add verified titles:

```json
{
  "version": 1,
  "romSha256": "COPY_THE_64_CHARACTER_HASH_FROM_MANIFEST_JSON",
  "tracks": [
    {
      "kind": "Music",
      "label": "COPY_THE_EXACT_DISCOVERY_LABEL_FROM_MANIFEST_JSON",
      "title": "Mountain Path"
    }
  ]
}
```

Replace the two placeholders with real manifest values. You can include just the tracks you know; `SFX` entries work too. Every `(kind, label)` pair must be unique. Titles must be nonempty single-line strings of at most 512 characters. The file must be no larger than 8 MB.

The fingerprint is SHA-256 of the assembled ROM bytes, excluding an optional 512-byte copier header. This makes a raw ROM and a ZIP containing the same ROM match, while a different revision gets its own profile. Old manifests without a fingerprint need a new export before you can create a profile.

Names attach to the discovered bank/command label, not the position in the result list. The filename still includes the stable track ID, so repeated song titles cannot overwrite each other. Unsafe filename characters are replaced and very long titles are shortened for the filesystem; the full title remains in the manifest. MIDI track metadata and the Logic package's `SNES Export.json` also receive the title.

A mismatched or malformed adjacent profile is ignored with a progress/debug-log message. Audio discovery and exports continue normally. The ripper ships without a game-specific title database; profiles contain names and identifiers, never ROM data or samples.

## Musical timing

A track entry may also include a `timing` object. This works for Logic and MIDI; WAV/MP3 playback is unchanged:

```json
"timing": {
  "originSeconds": 0.05,
  "meter": [4, 4],
  "tempo": [
    { "time": 0, "bpm": 137.5 },
    { "time": 12.05, "bpm": 110 }
  ]
}
```

Tempo-point times refer to seconds in the original extracted performance, before trimming. The first point must be at zero; later points must have strictly increasing times. BPM may range from 20 to 400. `originSeconds` is the original time that becomes Logic bar 1, beat 1. Only leading silence can be removed: an origin after an existing note is rejected. Leave it at zero to preserve all leading rests. `meter` is `[numerator, denominator]`; the default is 4/4.

The exporter integrates the tempo map to place notes and pitch bends on the beat grid. It preserves their relative timing, including swing and staggered attacks, rather than snapping notes to a quantization grid. With an origin above zero, only the specified leading silence is trimmed. Ordinary MIDI tick rounding and Logic's tempo precision introduce sub-millisecond timing differences in typical exports.

Without a timing profile, music exports attempt a constant-tempo estimate from repeated note patterns. This cannot uniquely determine the intended half/double-time pulse, meter, or a pickup; estimates assume 4/4 and anchor the first note at beat 1. Sparse or inconsistent patterns retain a 120 BPM reference, explicitly marked `unresolved` in the export metadata. Use a verified timing profile for tempo changes or a different metrical interpretation. Sound effects retain the reference timebase unless explicitly profiled.

### Exact source beats

When a sound-program trace provides its original musical tick positions, add `beatAnchors` to `timing`:

```json
"beatAnchors": [
  [0.05, 0],
  [0.562, 1],
  [1.058, 2]
]
```

Each pair is `[originalSeconds, musicalBeat]`; beats are quarter-note units starting at zero. The first pair must be `[originSeconds, 0]`. Both coordinates must strictly increase. Include at least two pairs and no more than 100,000. These positions must come from verified source timing, rather than guessing that every note belongs on an eighth-note grid.

The distinction matters: a console can schedule a note on beat 2 but deliver its sound-chip command several milliseconds later. Tempo alone leaves that note visibly late in Piano Roll. Source beat anchors place the note at its actual sequencer beat, while retaining written triplets, rests, and fractional-beat echo offsets. Releases and pitch bends are converted along the same map, interpolating between anchors. After the final anchor the tempo map supplies the remaining time conversion.

**This is a score-aligned export.** It removes execution delays and can slightly tighten playback compared with the console's real-time performance. Omit `beatAnchors` to preserve elapsed-time performance instead; WAV and MP3 are unaffected. The complete timing choice is recorded in the Logic project's `SNES Export.json` and export manifest.

### Instrument names

Logic's instrument tracks can use descriptive names supplied in the same local profile. Add an optional top-level `instruments` array alongside `tracks`:

```json
"instruments": [
  {
    "sampleSha256": "COPY_FROM_SNES_EXPORT_JSON",
    "name": "Warm Strings",
    "source": "My sample-library notes"
  }
]
```

Export once, then copy a sample's `sampleSha256` from the project's `SNES Export.json` or `Instrument Guide.txt`. Import the updated profile through the existing track-name import and export again. Up to 4,096 distinct sample names are supported, each at most 64 characters; source descriptions are optional single-line strings of at most 2,048 characters. The existing ROM fingerprint check still applies.

The fingerprint covers the decoded 16-bit mono PCM at 32 kHz and its loop settings. It does not depend on a sample slot, RAM address, voice, or envelope. The same sound can therefore keep its label across songs, while a replacement sound in the same slot does not inherit the wrong name. A source description records where the label came from; importing a name does not independently prove that identification. Profiles and game-specific dictionaries are not bundled with the application.

Names appear on both Logic tracks and MIDI regions, followed by `V` (original voice) and `S` (sample slot). Distinct envelope or tuning variants get numbered suffixes when necessary; they are not merged. Names describe the sampled sound rather than claiming a musical role such as lead or bass line. Unknown samples keep an explicit **Looped Sample** or **One-shot Sample** label; a track made entirely of DSP noise is labeled **Noise** even if its sample slot has a name.

The project also contains **Instrument Guide.txt** and structured `instruments` metadata in **SNES Export.json**. These retain the name's origin, source slots, sample fingerprint, loop, frame count, original ADSR/GAIN registers, note count, and Sampler detune. Sample duration is measured at unity playback before pitch, looping, or envelopes. The guide documents the captured envelope, not a promise of exact Sampler envelope emulation. This feature changes labels only: notes, timing, samples, and instrument routing are unchanged. Standalone MIDI still requires assigning instruments.

### Icons and rainbow colors

Logic export matches common instrument words in the profile description to Logic’s native artwork. More specific phrases take priority: **Acoustic Bass** gets an upright-bass icon, **Bass Drum** gets a kick, and **Electric Piano** gets electric keys. Unrecognized descriptions get a Sampler icon; the icon does not identify an unknown sample. Apple’s artwork stays in Logic and is not bundled with the ripper.

Tracks and their regions receive the same explicit color, progressing through the rainbow in track order. Up to 24 tracks use one brightness row; larger sessions add brightness variants at each hue. Logic has 96 palette colors, so sessions above 96 tracks reuse that ordered palette. Export metadata records each track’s native icon ID, icon description, and color index. These appearance fields leave notes, controllers, tempo, routing, and samples unchanged.

### Regions that show the phrases

A gap longer than one full measure between the last note ending and the next note starting creates a new region on the same track. The threshold follows the project meter: four quarter-note beats in 4/4, three in 3/4 or 6/8. Tempo changes do not change the musical threshold. A gap of exactly one measure stays inside the region, and a held or overlapping note prevents a false split.

Each region starts at its first note and ends at its last note release. This removes empty space at the edges without moving or quantizing any notes. Pan and pitch bends retain their absolute positions; every phrase keeps its track’s instrument, name, and color. “Rest” here means no active MIDI notes; a Sampler release or effect tail may continue sounding.

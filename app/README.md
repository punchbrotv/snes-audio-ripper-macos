![Inside the sound: Super Famicom and SNES hardware](../docs/assets/inside.jpg)

# Application source

The full application source is checked in here. [Build instructions](../README.md#build) live in the main README. Samsqwamch created the original Windows app and engine; PunchBro publishes this port, developed with Codex by OpenAI. See [credits](../CREDITS.md).

| File | Job |
| :--- | :--- |
| `main.js`, `preload.js`, `index.html` | Electron window, macOS menus, file selection, and music player |
| `input.js`, `parts.js` | Read ROMs, single-ROM ZIPs, and split files |
| `rip-worker.js`, `rip.js` | Background extraction, progress, cancellation, output folders |
| `record.js`, `songs.js`, `driver.js` | Emulate the game, capture sound memory, discover playback commands |
| `bank-rip.js` | Discover uploaded music banks and verify command tables through CPU memory reads |
| `timing.js` | Musical tempo maps, conservative pulse estimation, and performance-preserving time conversion |
| `track-names.js` | Match optional local soundtrack titles to exact ROM fingerprints and safe filenames |
| `catalog.js` | Keep discovery independent of format, preserve track IDs, and report export failures |
| `spc.js`, `spc700.js`, `render.js` | Sound-state handling, sound-CPU logic, and audio rendering |
| `export.js`, `mp3.js`, `wav.js` | Format validation, MP3 encoding, and lossless WAV output |
| `midi.js` | Experimental DSP-command tracing, sample tuning, and Standard MIDI File export |
| `logic.js`, `logic-data/` | Native Logic projects with original samples mapped to Sampler |
| `brr.js` | Raw instrument-sample fallback |
| `art.js`, `cover.js` | Optional cover-art lookup and processing |

`node_modules/`, `cores/`, and `helpers/` are installed by setup and ignored by Git. Game data and extracted audio are never source dependencies.

![Another console and controller photo collage](../docs/assets/footer.jpg)

Hardware photography: Evan-Amos, public domain. [Sources](../docs/assets/SOURCES.md).

![Twenty real public-domain SNES hardware photographs](../docs/assets/contact-03.jpg)

![Twenty real public-domain SNES hardware photographs](../docs/assets/contact-04.jpg)

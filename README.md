# SNES Audio Ripper for macOS

An **unofficial Apple Silicon macOS port** of [SNES Audio Ripper v1.0.0](https://github.com/Samsqwamch/SNES_Audio_Ripper/releases/tag/v1.0.0).

**Original Windows app and audio extraction engine: [Samsqwamch](https://github.com/Samsqwamch).**

**macOS port: [PunchBro](https://github.com/punchbrotv), built with [Codex by OpenAI](https://openai.com/codex/).** Codex implemented the macOS integration, build tooling, regression tests, and the Super Mario World USA profile at PunchBro's direction. See [CREDITS.md](CREDITS.md) for full attribution.

## What this port adds

- A self-contained Apple Silicon `.app`, preserving the original retro interface and MP3 player.
- Native macOS Snes9x emulation: no Wine or Rosetta required.
- ROM and single-ROM ZIP loading, split-file support, macOS file dialogs, and ⌘O.
- Background extraction, cancellation, output-folder selection, and numbered folders to avoid overwriting earlier exports.
- A verified Super Mario World USA profile that reads all three music banks and the sound-effect command ports.

## Why this repository contains a port recipe

The original repository publishes a Windows executable but no application source license. This repository contains the macOS additions, tests, and a checksum-verified transformation recipe. Setup downloads the **official Windows release directly from Samsqwamch**, reads its bundled JavaScript as an archive, and applies the port locally. It never runs the Windows executable.

The original application, artwork, dependencies, and prebuilt application bundle are not republished here. No game ROMs or extracted game audio are included. This is an independent port, not an official release or endorsement by Samsqwamch or OpenAI.

## Build on an Apple Silicon Mac

Requires macOS 13+, Node.js 22.12 or later, and Xcode Command Line Tools (`xcode-select --install` if needed). Network access is needed during setup.

```sh
git clone https://github.com/punchbrotv/snes-audio-ripper-macos.git
cd snes-audio-ripper-macos
npm ci
node node_modules/electron/install.js
npm run setup
npm test
npm run build
open 'dist/SNES Audio Ripper.app'
```

Setup verifies the original installer against a pinned SHA-256 hash, reconstructs the application, and compiles Snes9x from a pinned source commit. The `.app` includes its runtime and audio dependencies; end users do not need Node or build tools to run a locally built copy.

`app/` is generated and ignored by Git. Setup refuses to overwrite an existing `app/` so local changes are preserved; use a fresh checkout to regenerate it. If the system `tar` cannot read the installer, install a recent libarchive and set `BSDTAR` to its `bsdtar` executable when running setup.

The build is ad-hoc signed, not Apple-notarized. Intel Macs are not supported by these build scripts. Build-time download URLs and expected hashes are recorded in `scripts/setup.cjs` and `scripts/build-core.cjs`.

## Use

Drop a `.sfc`, `.smc`, or single-ROM `.zip` onto the window, or select **File → Open ROM…** (⌘O). Extract ZIPs containing several ROMs first.

Exports go into a game-named folder on your Desktop. **File → Choose Output Folder…** changes the destination for the current session. Repeated extractions create numbered folders. Click a finished track to play it, or **FOLDER** to reveal its directory. The square Stop button stops playback or cancels an active extraction while retaining completed files.

Command-line extraction is also available after setup:

```sh
npm run rip -- '/path/to/game.zip' '/path/to/output'
```

## Validation and limitations

The supplied, unmodified **Super Mario World (USA)** ROM produced **40 music/jingle MP3s and 92 sound-effect MP3s**. All 132 decoded successfully, contained non-silent audio, and had expected durations; no clipped samples were found. The GUI export matched the command-line output byte-for-byte. Launch, file selection, extraction, cancellation, playback, and pause were checked on an Apple Silicon Mac. A Stop-button dispatch issue was fixed and covered by a regression test. Six regression tests passed.

The SMW profile is enabled only for ROM SHA-256 `0838e531fe22c077528febe14cb3ff7c492f1f5fa8de354192bdff7137c27f5b`. It reads all audio data from the user's ROM. Filenames identify music bank and command, rather than official track titles. Music counts include jingles and variations; duplicate pointers within each bank are omitted. The output `manifest.json` records commands, durations, and detected loops. Looping tracks generally play twice and fade; long tracks can be capped.

Other games retain the original heuristic extraction engine and have **not been validated**. Completeness depends on the game's sound driver; raw-sample fallback does not guarantee complete songs or original in-game pitch.

Optional packaged-runtime and audio validation, using a ROM you provide:

```sh
ELECTRON_RUN_AS_NODE=1 'dist/SNES Audio Ripper.app/Contents/MacOS/Electron' \
  scripts/test-packaged.cjs '/path/to/game.zip'
# For an SMW export with manifest.json; requires FFmpeg on PATH:
node scripts/verify-output.cjs '/path/to/exported/game'
```

## Repository layout

- `port/new-files/`: original macOS additions and SMW profile.
- `port/edits.json`: byte-range changes with source/result hashes; unchanged upstream files are omitted.
- `scripts/setup.cjs`: verified upstream download and local reconstruction.
- `scripts/build-core.cjs`: Snes9x source download and native compilation.
- `scripts/build-macos.cjs`: app packaging and local code signing.
- `tests/`: synthetic regression tests; no ROM fixtures.
- `app/`, `upstream/`, `build/`, `dist/`, `output/`: generated locally and excluded from Git.

Original port contributions are under the scoped [MIT license](LICENSE). Upstream components retain their own terms; this license does not grant rights to the original application or game content. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

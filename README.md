<p align="center"><img src="docs/assets/hero.jpg" alt="SNES Audio Ripper for macOS — a collage of real Super Nintendo consoles and controllers" width="100%"></p>

<h1 align="center">SNES Audio Ripper for macOS</h1>
<p align="center"><b>Little gray console. Ridiculously good music. Now on your Mac.</b></p>
<p align="center">
  <img src="https://img.shields.io/badge/macOS-13%2B-24212f?style=for-the-badge&logo=apple" alt="macOS 13 or later">
  <img src="https://img.shields.io/badge/Apple_Silicon-native-6640b2?style=for-the-badge" alt="Native Apple Silicon">
  <img src="https://img.shields.io/badge/export-WAV%20%7C%20MP3%20%7C%20MIDI-d9ccef?style=for-the-badge" alt="WAV, MP3, and MIDI export">
  <a href="https://github.com/punchbrotv/snes-audio-ripper-macos/releases/latest"><img src="https://img.shields.io/github/v/release/punchbrotv/snes-audio-ripper-macos?style=for-the-badge&color=6640b2" alt="Latest release"></a>
</p>
<p align="center">
  <a href="#download">Download</a> · <a href="#use">Use</a> · <a href="#how-it-works">How it works</a> · <a href="#build">Build</a> · <a href="#credits">Credits</a> · <a href="docs/GALLERY.md">Even more SNES</a>
</p>

An unofficial Apple Silicon port of **[Samsqwamch’s SNES Audio Ripper](https://github.com/Samsqwamch/SNES_Audio_Ripper/releases/tag/v1.0.0)**. Drop in a SNES ROM or single-ROM ZIP, export music and sound effects as **WAV, MP3, or MIDI**. Preview WAV/MP3 in the built-in player; open MIDI in your DAW.

**Original Windows app and extraction engine: Samsqwamch. macOS port: [PunchBro](https://github.com/punchbrotv), built with [Codex by OpenAI](https://openai.com/codex/).**

![SNES hardware contact sheet 1: twenty real public-domain photographs](docs/assets/contact-01.jpg)

## Download

![Press Start — three more photographs of SNES hardware](docs/assets/download.jpg)

### [⬇ Download the Mac app](https://github.com/punchbrotv/snes-audio-ripper-macos/releases/latest)

Download **SNES-Audio-Ripper-macOS-arm64.zip**, unzip it, and move **SNES Audio Ripper.app** to Applications. Requires **an Apple Silicon Mac running macOS 13 or later**. Intel Macs are not supported by this build.

The download includes the app, emulator, and audio tools. **No Node.js, Windows installer, or source gathering is needed to run it.** Developers can build directly from the application source checked into this repository.

The app is ad-hoc signed, not Apple-notarized. If macOS blocks it, use **System Settings → Privacy & Security → Open Anyway** after trying to open it, if you trust this download. Release assets include a SHA-256 checksum file.

| Small app rituals | What you get |
| :--- | :--- |
| 📦 Drop a ROM or ZIP | `.sfc`, `.smc`, and single-ROM ZIP loading; split files supported |
| 🎵 Extract the sound | WAV or MP3 audio; experimental editable MIDI notes |
| ▶ Press play | Original retro interface with a built-in audio player |
| ⌘ Make yourself at home | Native file dialogs, ⌘O, and an output-folder picker |
| ⏹ Change your mind | Background extraction with cancellation; completed files stay saved |
| 🗂 Run it again | Numbered output folders preserve earlier exports |

![SNES hardware contact sheet 2: twenty real public-domain photographs](docs/assets/contact-02.jpg)

## Use

![Drop, rip, play — controller, mouse, and console photo collage](docs/assets/use.jpg)

Choose **EXPORT AS → MP3, WAV, or MIDI** before opening a ROM. Your choice is remembered.

| Format | Best for |
| :--- | :--- |
| **MP3** | Compact, ready-to-listen audio |
| **WAV** | Lossless 16-bit PCM audio for editing and sampling |
| **MIDI (experimental)** | Editable notes in eight voice tracks; estimated sample tuning and piano placeholders you can replace in your DAW |

MIDI reconstructs performance data from sound-chip commands. It does not contain the original samples, envelopes, or DSP effects. Unpitched samples use a placeholder note; sounds without recoverable note events are skipped. Click an exported MIDI file to open it in your system’s MIDI app.

1. **Drop** a ROM or ZIP onto the window, or choose **File → Open ROM…** (⌘O). Unzip archives containing multiple ROMs first.
2. **Extract.** The app creates a game-named folder on your Desktop. Change the destination with **File → Choose Output Folder…** for the current session.
3. **Open the results.** Click a WAV/MP3 track to play it, or a MIDI track to open it in your MIDI app. **FOLDER** reveals the files in Finder. The square Stop button stops playback or cancels extraction.

Bring your own ROM. Game ROMs and extracted game audio are not included in the repository or release.

![SNES hardware contact sheet 3: twenty real public-domain photographs](docs/assets/contact-03.jpg)

## How it works

![Inside the sound — Super Famicom and SNES hardware portraits](docs/assets/inside.jpg)

A SNES game usually doesn't store its soundtrack as a folder of ready-made songs. Think of it as a tiny band packed into a cartridge:

- **Instrument samples** are short recordings, such as a drum hit or a bit of a flute tone.
- **Musical instructions** say which notes to play, how long to hold them, and when to loop.
- **A sound program** acts as the conductor, telling the SNES sound hardware how to combine everything.

The ripper finds those ingredients and runs the sound program on **emulated sound hardware**: software that reproduces the behavior of the console's audio chips. It calculates the resulting sound wave, tidies up the ending, and writes WAV audio or compresses it into MP3. For MIDI, it follows the sound program’s note and pitch commands instead of storing the waveform.

```mermaid
flowchart TD
    A["Your ROM or ZIP"] --> B["Read the game's data"]
    B --> C["Run the game in Snes9x and capture sound memory"]
    C --> D["Discover sound programs, samples, and playback commands"]
    D --> E["Run the sound program on emulated sound hardware"]
    E --> F["Record, trim, fade: WAV or MP3"]
    D --> M["Trace note commands: editable MIDI"]
    F --> G["Export folders + audio player"]
    M --> H["Export folders + your MIDI app"]
    classDef input fill:#d9ccef,stroke:#6640b2,color:#24212f
    classDef output fill:#6640b2,stroke:#24212f,color:#fff
    class A,B,C input
    class F,G output
```

**Finding the band.** A headless emulator runs the game with simulated button presses, captures sound memory, and searches for commands that produce distinct audio. The extraction engine works from the data and sound program inside the ROM you supply.

**From memory to music.** The SPC sound renderer turns the game's sound program and samples into raw audio (PCM). The app saves those samples in WAV files or compresses them into MP3. MIDI instead records note events traced from the sound program. Extraction runs in a background worker so the window can stay responsive.

**Sometimes the map is missing.** Different games use different sound programs. If discovery finds no usable recordings, WAV and MP3 exports can fall back to scanning for raw compressed instrument samples (BRR). These are individual sounds; that fallback does not guarantee complete songs or their original in-game pitch. MIDI needs recoverable note events and cannot use this raw-sample fallback.

![Twenty more real SNES hardware photographs](docs/assets/contact-04.jpg)

Want the code tour? Start with [the application guide](app/README.md).

![SNES hardware contact sheet 5: twenty real public-domain photographs](docs/assets/contact-05.jpg)

## Build

![Build your own — real Super Famicom and SNES mouse photos](docs/assets/build.jpg)

Requires **macOS 13+, Apple Silicon, Node.js 22.12+, and Xcode Command Line Tools**. Install the latter with `xcode-select --install` if needed.

```sh
git clone https://github.com/punchbrotv/snes-audio-ripper-macos.git
cd snes-audio-ripper-macos
npm ci
npm run setup
npm test
npm run build
open 'dist/SNES Audio Ripper.app'
```

**The application source lives in `app/`.** Setup installs pinned dependencies and compiles a pinned Snes9x core. It does not download or unpack the Windows release. Network access is needed for dependency setup; the finished app includes its runtime and extraction dependencies. Optional cover-art lookup uses the network when available.

<details>
<summary><b>Command line and repository map</b></summary>

```sh
npm run rip -- '/path/to/game.zip' '/path/to/output' wav
# Last argument: mp3 (default), wav, or midi
```

| Location | What's inside |
| :--- | :--- |
| [`app/`](app/README.md) | Full application source, macOS integration, audio engine |
| [`scripts/`](scripts/README.md) | Dependency setup, native-core build, packaging, validation |
| [`tests/`](tests/README.md) | Synthetic regression tests; no ROM fixtures |
| [`docs/`](docs/README.md) | Documentation, public-domain photo gallery, release notes |
| `build/`, `dist/`, `output/` | Local generated files, excluded from Git |

The original source and artwork are included with permission from the original author, as confirmed by PunchBro. Original port contributions have a scoped [MIT license](LICENSE); upstream components retain their own terms. See [third-party notices](THIRD_PARTY_NOTICES.md).

</details>

![SNES hardware contact sheet 6: twenty real public-domain photographs](docs/assets/contact-06.jpg)

## Credits

![Player two — SNES and Super Famicom photo collage](docs/assets/credits.jpg)

| Player | Contribution |
| :--- | :--- |
| **[Samsqwamch](https://github.com/Samsqwamch/SNES_Audio_Ripper/releases/tag/v1.0.0)** | Original Windows app, extraction engine, retro interface, and app artwork |
| **[PunchBro](https://github.com/punchbrotv)** | Commissioned and publishes this macOS port |
| **[Codex by OpenAI](https://openai.com/codex/)** | macOS adaptation, build tooling and validation under PunchBro's direction |
| **[Evan-Amos / Vanamo Media](https://commons.wikimedia.org/wiki/User:Evan-Amos)** | Every real hardware photograph decorating these docs; public domain |
| **The supporting projects** | Electron, Snes9x/libretro, Koffi, spc-converter, lamejs/LAME |

[Full credits](CREDITS.md) · [Component notices](THIRD_PARTY_NOTICES.md) · [Every photo's source and editing notes](docs/assets/SOURCES.md)

This is an independent port, not an official release or endorsement by Nintendo, Samsqwamch, or OpenAI. The hardware photos are independent public-domain photography, not official Nintendo advertisements. **No AI-generated imagery is used.**

![SNES hardware contact sheet 7: twenty real public-domain photographs](docs/assets/contact-07.jpg)

## Yes, more SNES

![A deliberately excessive twelve-frame collage of eight real SNES and Super Famicom hardware photos](docs/assets/wall.jpg)

You reached the end of an audio tool's README and somehow toured a hardware museum. **[There is still more SNES in the gallery.](docs/GALLERY.md)**

![Thanks for playing — another three SNES photos, because restraint was not the assignment](docs/assets/footer.jpg)

![The final twenty SNES photos. For now.](docs/assets/contact-08.jpg)

# Credits

## Original Windows release

**Samsqwamch** created **SNES Audio Ripper**, including the original Windows application, retro interface, artwork, and extraction engine.

- Original project: https://github.com/Samsqwamch/SNES_Audio_Ripper
- Original Windows release used by this port: https://github.com/Samsqwamch/SNES_Audio_Ripper/releases/tag/v1.0.0

This macOS project builds on that work. It does not claim authorship of the original app or engine and is not an official upstream release.

## macOS port

**PunchBro** commissioned and publishes this port at https://github.com/punchbrotv/snes-audio-ripper-macos.

**Codex by OpenAI** implemented the macOS adaptation and build tooling, added the verified Super Mario World USA extraction profile, and performed automated and GUI validation under PunchBro's direction.

Codex: https://openai.com/codex/

## Supporting projects

- Electron — application runtime.
- Snes9x and libretro — native SNES emulator core and frontend API.
- Koffi — native-library bindings.
- spc-converter and its SPC-player contributors — WebAssembly sound-chip rendering.
- @breezystack/lamejs and LAME contributors — MP3 encoding.
- SMWDisX contributors, including its credited SPC700 research — reference for the SMW sound program's bank layout and command ports.

See THIRD_PARTY_NOTICES.md for versions, source links, and license information. No endorsement by any credited project or company is implied.

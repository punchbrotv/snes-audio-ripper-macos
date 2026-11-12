# Component provenance and licensing

## Original application

[SNES Audio Ripper v1.0.0 by Samsqwamch](https://github.com/Samsqwamch/SNES_Audio_Ripper/releases/tag/v1.0.0) is the basis of this unofficial port. The public upstream repository contains only a README, and no application source license was published in that repository or the inspected bundle.

This repository does not include the original application or artwork. Setup downloads the official release and reconstructs the macOS application locally. The port license does not grant rights to upstream components. Review the relevant authors' terms before redistributing a built application.

Original installer SHA-256: `3304e159490baaacfb77408d20c555d6fc938a895aee811b38af604215283820`.

## Runtime and audio dependencies

- [Electron](https://github.com/electron/electron) 45.3.1 — MIT; Electron and Chromium notices are copied into the built app's Resources.
- [Koffi](https://github.com/Koromix/koffi) 2.16.3 — MIT; package license retained locally.
- [@breezystack/lamejs](https://www.npmjs.com/package/@breezystack/lamejs) 1.2.7 — LGPL-3.0; package license retained locally.
- [spc-converter](https://github.com/kethinov/spc-converter) 1.0.0 — LGPL-2.1-only; package license retained locally. Its WebAssembly SPC player credits the smwcentral-spc-player project in its source.
- [Snes9x/libretro](https://github.com/libretro/snes9x) — native core compiled from commit `fae2fea08f74180759ef540ee94259213f503480` (Snes9x 1.63). Source archive SHA-256: `0d4b0c4181d66668ec0040eb17f90a559f7b7fa6cbd9198593c3bdbe79acd029`. The upstream Snes9x license, including its restrictions, is copied to the generated `app/licenses/Snes9x.txt`. It is not covered by this project's MIT license.

The initial local test used a libretro nightly core reporting the same source revision. Public setup compiles the pinned source instead of depending on a mutable nightly binary URL.

## Super Mario World profile references

Bank and command-port facts were checked against [SMWDisX bank_00](https://github.com/IsoFrieze/SMWDisX/blob/master/bank_00.asm), [bank_0E](https://github.com/IsoFrieze/SMWDisX/blob/master/bank_0E.asm), and [bank_03](https://github.com/IsoFrieze/SMWDisX/blob/master/bank_03.asm). The profile includes offsets, counts, and a ROM hash, not game data. It reads sound data from a user-supplied ROM.

ROMs and extracted game audio are excluded from this repository.

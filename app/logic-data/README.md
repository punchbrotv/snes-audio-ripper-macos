# Empty Logic Sampler state

`sampler.bin` is a UCuA insert record captured from a new, empty Logic Sampler
instrument created for this project. It contains default settings and editor state,
not sample audio, user music, or third-party presets. Keep the complete record:
removing its trailing state makes Logic load a silent instrument.

The exporter inserts its own EXS zones/sample references and writes the original
BRR-decoded samples into each user's output project. It updates all three size
fields and the channel-strip ordinal. No ROM-specific data is in this seed.

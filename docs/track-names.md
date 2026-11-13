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

Replace the two placeholders with real manifest values. You can include just the tracks you know; `SFX` entries work too. Every `(kind, label)` pair must be unique. Titles must be nonempty single-line strings of at most 512 characters. The file must be no larger than 1 MB.

The fingerprint is SHA-256 of the assembled ROM bytes, excluding an optional 512-byte copier header. This makes a raw ROM and a ZIP containing the same ROM match, while a different revision gets its own profile. Old manifests without a fingerprint need a new export before you can create a profile.

Names attach to the discovered bank/command label, not the position in the result list. The filename still includes the stable track ID, so repeated song titles cannot overwrite each other. Unsafe filename characters are replaced and very long titles are shortened for the filesystem; the full title remains in the manifest. MIDI track metadata and the Logic package's `SNES Export.json` also receive the title.

A mismatched or malformed adjacent profile is ignored with a progress/debug-log message. Audio discovery and exports continue normally. The ripper ships without a game-specific title database; profiles contain names and identifiers, never ROM data or samples.

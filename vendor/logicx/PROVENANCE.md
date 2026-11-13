# LogicProFormatWriter subset

Source: https://github.com/jonkubis/LogicProFormatWriter
Commit: `9935ca88a3fad4c4232eb9dd755149e9cc9b9b65`
Author: Jon Kubis. License: MIT (see LICENSE).

`projectdata.py`, `data/mixed_base.seed`, and `data/infra.json.gz` are copied unchanged.
The empty `__init__.py` intentionally exposes only the structural writer; unrelated
upstream CLI, audio conversion, fixtures, and inspection modules are not bundled.
The seeds contain project structure, not songs or instrument recordings.
Our integration lives in `scripts/logic-writer.py` and is frozen into the app at build time.

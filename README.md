# YomiCord

YomiCord is a Vencord user plugin focused on Japanese sentence breakdown and fast Anki mining.

## Highlights
- Clause level sentence breakdown
- Word, grammar, and kanji extraction
- One-click add to Anki via AnkiConnect
- Duplicate detection with quick open in Anki Browser
- Optional auto image attach workflow
- Kanji details with meaning, Kun reading, and On reading

## Files
- index.tsx: main plugin UI and logic
- native.ts: desktop native helper functions

## Requirements
- Vencord (desktop)
- Anki running with AnkiConnect enabled

## Install (Vencord dev workflow)
1. Place this plugin folder under your Vencord userplugins path.
2. Build Vencord.
3. Inject/patch Discord with your Vencord build.

## Notes
This repository contains the standalone plugin source so it is easy to iterate and share.

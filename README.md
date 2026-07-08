# YomiCord

YomiCord is a Vencord user plugin for Japanese sentence breakdown and fast Anki mining directly from Discord.

## Why YomiCord
- Mine words, grammar, and kanji from real messages
- Keep your workflow inside Discord
- Push notes to Anki in one click
- Handle duplicates without losing context

## Features
- Clause-based breakdown for selected Japanese text
- Per-clause tabs for Words, Grammar, and Kanji
- One-click note creation for term, grammar, sentence, and kanji cards
- Duplicate detection with quick open action in Anki Browser
- Kanji details panel with meaning, Kun reading, and On reading
- Configurable deck, model, and field mapping per card type
- Optional image auto-attach pipeline for mined notes

## Screenshots
Add your screenshots here to showcase the workflow.

- Lookup modal overview
- Breakdown tabs (Words / Grammar / Kanji)
- Kanji meaning details panel
- Duplicate action opening the existing Anki note

## Requirements
- Discord desktop with Vencord
- Anki desktop
- AnkiConnect add-on enabled

## Installation
1. Copy this plugin folder into your Vencord userplugins directory.
2. Build Vencord.
3. Inject or patch Discord with your Vencord build.
4. Open plugin settings and configure Anki deck/model mappings.

## Quick Start
1. Highlight Japanese text in Discord.
2. Open YomiCord from the message context menu.
3. Review Words, Grammar, or Kanji breakdown.
4. Click add on the chips you want to mine.
5. If a duplicate is found, use the duplicate action to open the existing note in Anki.

## Settings Guide
YomiCord includes a Setup tab with practical onboarding:
- AnkiConnect URL
- Auto image attach toggle
- CORS guidance when deck loading fails
- Mapping tokens for each card type

## Mapping Tokens (Summary)
- Common: {expression}, {glossary}, {reading}, {sentence}, {translation}, {image}
- Kanji: {kunyomi}, {onyomi}, {keywords}, {strokes}, {grade}, {jlpt}

## Troubleshooting
- Anki not detected: confirm Anki is running and AnkiConnect is enabled
- Deck/model lists not loading: verify AnkiConnect URL and CORS allowlist
- Wrong image attached: copy a fresh image after opening lookup, then add note
- Duplicate open mismatch: update to latest commit, then retry duplicate action

## Project Structure
- index.tsx: UI, breakdown logic, dictionary lookups, Anki integration
- native.ts: desktop native helpers (clipboard and native fetch bridge)

## Roadmap
- Optional confidence indicators per breakdown row
- Optional quick action bar for batch adds
- Additional kanji metadata formatting options

## Contributing
Issues and pull requests are welcome.

## License
GPL-3.0-or-later

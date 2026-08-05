# Parallel Bible

A bilingual Bible reader built with Next.js, React, and TypeScript. English and simplified Chinese passages stay aligned paragraph by paragraph, with reference search, responsive language controls, appearance settings, highlights, Markdown notes, and local JSON backups.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Validate

```bash
npm run typecheck
npm run build
```

## Project structure

- `app/` — Next.js App Router entry point, metadata, and global styles
- `components/parallel-bible.tsx` — interactive reader and annotation UI
- `lib/bible-source.ts` — typed passage loading, reference parsing, and search
- `lib/bible-books.ts` — canon metadata and editorial paragraph alignment
- `lib/types.ts` — shared application types

## Data and storage

- World English Bible and Chinese Union Version passages are loaded from `bible-api.com`.
- English keyword search uses `dailybible.ca` and falls back to already loaded chapters.
- Optional ESV sources retain the original app’s attribution and browser-only API-key behavior.
- Preferences, reading position, highlights, and notes are stored in the browser’s local storage and can be exported as JSON.

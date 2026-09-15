# Incremental Update Guide

The executable, always-current workflow lives in [CLAUDE.md](CLAUDE.md) —
follow Steps 1–8 there. This file intentionally contains no copies of the
commands, because duplicated instructions drift (a stale copy of the scroll
loop in this repo once masked a syntax error for months).

Quick orientation:
- **Seed loading** (Step 4): `bun export-seed-ids.ts`, then the
  `browser_run_code_unsafe` primary path (executes the generated
  `data/seed-loader.js` via its `filename` parameter) with the chunked
  fallback.
- **Auto-stop**: scrolling halts after 5 consecutive all-existing batches, at
  page bottom, or when the capture-stall watchdog fires.
- **Merging** (Step 8): `bun combine-bookmarks.ts` — canonical data is
  `data/x-bookmarks-latest.json`; the script refuses to shrink it and keeps
  the 5 newest backups. Bookmarks seen more than once are merged by
  `mergeBookmark` (newer tweet data, earliest `capturedAt`).
- **Quoted tweet backfill**: a one-time full re-scrape. See Troubleshooting →
  "Backfilling quoted tweets" in CLAUDE.md.

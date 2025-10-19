# Incremental Bookmark Update Guide

**A user-friendly guide to updating your bookmark collection without re-downloading everything.**

## What is Incremental Update?

Instead of re-capturing all 22,000+ bookmarks every time you want to update your collection, incremental mode:
- Remembers which bookmarks you already have
- Only captures NEW bookmarks you've added since last time
- Automatically stops when it reaches bookmarks you already saved
- Saves time (seconds vs minutes) and bandwidth

## When to Use It

**Use incremental mode when:**
- You've already extracted your bookmarks at least once
- You have an `x-bookmarks-latest.json` file in your project directory
- You want to capture only new bookmarks since your last extraction
- You bookmark regularly and want quick updates

**Use first-time extraction when:**
- This is your first time extracting bookmarks
- You want to start completely fresh
- You don't have an existing `x-bookmarks-latest.json` file

## How to Request Incremental Update

Simply tell Claude Code one of these phrases:

```
"Extract my bookmarks in incremental mode"
"Update my bookmarks since the last extraction"
"Capture only new bookmarks"
"Run an incremental bookmark update"
```

Claude will automatically:
1. Navigate to your X bookmarks page
2. Wait for you to login
3. Inject the bookmark interceptor
4. Load your existing `x-bookmarks-latest.json` file from the current directory
5. Start capturing only NEW bookmarks
6. Stop automatically when encountering bookmarks you already have

## What You'll See

When Claude runs incremental mode, you'll see console messages like:

**Initial Setup:**
```
✅ Interceptor ready!
[X-Bookmarks-GraphQL] GraphQL interceptor installed
[X-Bookmarks-GraphQL] Execution context check passed
[X-Bookmarks-GraphQL] Loaded 22540 existing bookmark IDs
[X-Bookmarks-GraphQL] Auto-scroll will stop when encountering bookmarks that already exist
✅ Existing bookmarks loaded!
🚀 Starting auto-scroll in 3 seconds...
```

**During Extraction:**
```
📜 Auto-scroll 1/10000 - Scrolled to: 8262
[X-Bookmarks-GraphQL] ✅ Captured 20 new bookmarks (0 already existed, total: 20)
📜 Auto-scroll 2/10000 - Scrolled to: 17792
[X-Bookmarks-GraphQL] ✅ Captured 14 new bookmarks (6 already existed, total: 34)
[X-Bookmarks-GraphQL] ⏭️  Skipping existing bookmark: 1977089288895345130
```

**Auto-Stop:**
```
[X-Bookmarks-GraphQL] ⚠️  All 20 bookmarks in this batch already exist (consecutive: 5/5)
[X-Bookmarks-GraphQL] 🛑 Stopping auto-scroll: encountered 5 consecutive batches
🏁 Auto-scroll stopped: All recent bookmarks already exist in your collection.
📊 Captured 34 new bookmarks.
```

## How It Works Behind the Scenes

1. **Load Existing IDs**: Claude loads all your existing bookmark IDs (22,540+) into memory
2. **Check Each Bookmark**: As new bookmarks are captured, they're checked against existing IDs
3. **Skip Duplicates**: Bookmarks you already have are automatically skipped
4. **Track Progress**: The system counts consecutive batches where ALL bookmarks already exist
5. **Auto-Stop**: After 5 consecutive batches of only existing bookmarks, the extraction stops

**Why 5 batches?** This ensures the system doesn't stop too early if you have a few old bookmarks mixed with new ones. It only stops when it's confident you've reached the "already saved" section.

## Required Files

For incremental mode to work, you need:

**Essential:**
- `x-bookmarks-latest.json` - Your previous bookmark extraction (must be in project directory)

**Scripts (already in the repo):**
- `interceptor-no-autostart.js` - The interceptor script (used in incremental mode)
- `graphql-interceptor.js` - Original auto-start version (optional)

## Benefits

✅ **Faster**: Only captures new bookmarks (takes seconds instead of minutes)
✅ **Efficient**: Stops automatically when reaching old bookmarks
✅ **Smart**: Doesn't scroll through thousands of bookmarks you already have
✅ **Safe**: Original bookmarks are never modified
✅ **Bandwidth-Friendly**: Downloads only what's new

## Common Questions

### What if I don't have `x-bookmarks-latest.json`?

Then you need to do a **first-time extraction** instead. Just tell Claude:
```
"Extract all my bookmarks"
```

Claude will skip the incremental mode steps and capture everything from scratch.

### What if the file is in a different location?

Make sure `x-bookmarks-latest.json` is in your project directory (`/Users/howardwu/dev/cc-scrape-x-bookmarks`). Claude automatically looks there.

If it's somewhere else, either:
- Copy it to the project directory, or
- Tell Claude: "Use incremental mode with the file at /path/to/your/file.json"

### What if I want to start completely fresh?

Just tell Claude to do a first-time extraction:
```
"Extract all my bookmarks"
"Do a full bookmark extraction"
```

Claude will skip loading the existing file and capture everything.

### How do I combine new bookmarks with old ones?

After extraction completes, just run the combine script:
```bash
bun combine-bookmarks.ts
```

The script automatically:
- Finds all bookmark files (graphql extractions, combined files, and latest.json)
- Merges them with deduplication by bookmark ID
- Creates timestamped backups before overwriting
- Won't overwrite if the new file has fewer bookmarks (data loss protection)

## What Happens to Downloaded Files?

New bookmarks are downloaded as:
- `x-bookmarks-graphql-2025-10-15T04-56-07.json` (timestamped file)

Located in your Downloads folder or Playwright output directory.

After combining, you'll get:
- `x-bookmarks-combined-YYYY-MM-DD.json` (all bookmarks merged)
- `x-bookmarks-latest.json` (symlink to most recent)

---

**Ready to capture only new bookmarks?** Just tell Claude: "Extract my bookmarks in incremental mode" 🎉

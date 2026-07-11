# X Bookmark Extractor - Complete Process

**Extract ALL your X (Twitter) bookmarks with real engagement metrics.**

## 🔄 Incremental Updates (Recommended!)

If you already have `data/x-bookmarks-latest.json`, you can capture only **new** bookmarks:

**Benefits:**
- Only captures NEW bookmarks you haven't saved yet
- Automatically stops scrolling after encountering 5 consecutive batches of existing bookmarks
- Saves time and bandwidth (seconds vs minutes)
- No need to scroll through 22,540+ existing bookmarks

---

## 🚀 Complete Process

### Step 1: Navigate to X Bookmarks
```javascript
await mcp__playwright__browser_navigate({ url: "https://x.com/i/bookmarks" });
```

### Step 2: User Login
Let user login with their X account. Wait for confirmation before continuing.

### Step 3: Inject Interceptor (No Auto-Start)
```javascript
const script = await Bun.file('./interceptor-no-autostart.js').text();
await mcp__playwright__browser_evaluate({
  function: `() => { ${script} }`,
  element: "GraphQL interceptor (no auto-start)"
});
```

### Step 4: Load Existing Bookmarks (For Incremental Updates)

**For first-time extraction: skip this step entirely.**

First, regenerate the seed file and note the count it prints:

```bash
bun export-seed-ids.ts
# ✅ Wrote <COUNT> seed IDs to ./data/seed-ids.json
```

#### Primary path: `browser_run_code_unsafe` (loads ALL IDs, one call)

`bun export-seed-ids.ts` also generated `data/seed-loader.js` — a self-contained
snippet with every ID inlined. The tool's sandbox has no `require()` and no
dynamic `import()` (verified 2026-07-11), so the loader is executed from disk
via the `filename` parameter and the IDs never pass through the model:

```javascript
await mcp__playwright__browser_run_code_unsafe({
  filename: "/Users/howardwu/dev/cc-scrape-x-bookmarks/data/seed-loader.js"
});
```

**Expected:** the tool result exceeds the response token limit (it echoes the
~650KB loader code) and the harness saves it to a file, reporting the path.
That is normal. Extract the verification line:

```bash
grep -o 'Loaded [0-9]* of [0-9]* seed IDs' <saved-output-file>
```

**MANDATORY verification:** it must print `Loaded N of N seed IDs` with both
numbers equal to the count printed by `export-seed-ids.ts`. If the numbers
differ, or the tool errors, DO NOT start scrolling — fall back to the chunked
path below.

#### Fallback path: chunked `browser_evaluate` (top 5,000 by capture recency)

Use only if `browser_run_code_unsafe` is unavailable or failed verification.
`seed-ids.json` is sorted by `capturedAt` descending, so the first 5,000 IDs
are the ones most recently seen at the top of the bookmarks feed — NOT the
top of the timestamp-sorted collection file, which sorts by tweet creation
date and misses recently-bookmarked old tweets.

```bash
# Chunk 1 of 2:
jq -c '.ids[0:2500]' data/seed-ids.json
# Chunk 2 of 2:
jq -c '.ids[2500:5000]' data/seed-ids.json
```

Inject chunk 1 (clears first), then chunk 2 (accumulates):

```javascript
await mcp__playwright__browser_evaluate({
  function: `() => {
    window.bookmarkInterceptor.existingBookmarkIds.clear();
    window.bookmarkInterceptor.loadExistingBookmarks({
      bookmarks: CHUNK_1_IDS_ARRAY.map(id => ({ id })) });
    return 'Set size: ' + window.bookmarkInterceptor.existingBookmarkIds.size;
  }`,
  element: "Load seed IDs chunk 1/2"
});
await mcp__playwright__browser_evaluate({
  function: `() => {
    window.bookmarkInterceptor.loadExistingBookmarks({
      bookmarks: CHUNK_2_IDS_ARRAY.map(id => ({ id })) });
    return 'Set size: ' + window.bookmarkInterceptor.existingBookmarkIds.size;
  }`,
  element: "Load seed IDs chunk 2/2"
});
```

**MANDATORY verification:** the final call must return `Set size: 5000` (or
the total collection size if smaller). A lower number means a chunk was
dropped or corrupted — re-inject before scrolling.

### Step 5: Start Auto-Scroll

The scroll loop lives in `interceptor-no-autostart.js` (`startAutoScroll`). Do not paste a copy of the loop here — just invoke it:

```javascript
await mcp__playwright__browser_evaluate({
  function: `() => { startAutoScroll(); return 'auto-scroll started'; }`,
  element: "Start auto-scroll"
});
```

It stops automatically when: (a) 5 consecutive batches contain only existing bookmarks (incremental mode), (b) the bottom of the page is reached, (c) the max scroll limit is hit, or (d) **watchdog**: 10 scrolls pass with zero intercepted bookmark responses — which means the interceptor is broken and the run must be investigated, not retried blindly.

### Step 6: Monitor Auto-Extraction
The system auto-scrolls and captures bookmarks. Monitor progress via console messages.

### Step 7: Check Progress
```javascript
await mcp__playwright__browser_evaluate({
  function: `() => {
    const count = window.bookmarkInterceptor ? window.bookmarkInterceptor.getBookmarkCount() : 'N/A';
    const stopped = window.bookmarkInterceptor ? window.bookmarkInterceptor.shouldStopAutoScroll() : false;
    return \`New bookmarks: \${count}, Auto-scroll stopped: \${stopped}\`;
  }`,
  element: "Check bookmark extraction progress"
});
```

**Note:** This returns a simple string to avoid response size limits. Complex objects can exceed token limits.

### Step 8: Combine All Files

```bash
# Input: directory where the browser saved x-bookmarks-graphql-*.json downloads
# (check the Playwright session's download location). Output always goes to ./data/.
BOOKMARK_FILES_DIR="/path/to/downloads" bun combine-bookmarks.ts
```

The canonical collection lives at `data/x-bookmarks-latest.json` and is merged
automatically on every run — no copy step is needed. The script refuses to
shrink the collection and writes a timestamped backup before every update.

## 📊 What You Get

- **All bookmarks** (not just 5-10 visible ones)
- **Real engagement metrics** (likes, retweets, replies, views)
- **Complete user data** (verification status, display names) 
- **Media attachments** (photos, videos)
- **Timestamps and URLs**
- **Automatic deduplication**

## 🔄 Combine Multiple Files (Optional)

See Step 8 above — `BOOKMARK_FILES_DIR="/path/to/downloads" bun combine-bookmarks.ts` writes output to `./data/`. No default search path; you must supply the directory where the browser saved the `x-bookmarks-graphql-*.json` files.

## 📋 Console Output Example

**Full Extraction Mode (First Time):**
```
✅ Interceptor ready! Use window.bookmarkInterceptor
[X-Bookmarks-GraphQL] GraphQL interceptor installed
[X-Bookmarks-GraphQL] Execution context check passed
🚀 Starting auto-scroll in 3 seconds...
📜 Auto-scroll 1/10000 - Scrolled to: 8262
[X-Bookmarks-GraphQL] Detected bookmark GraphQL request
[X-Bookmarks-GraphQL] ✅ Captured 20 new bookmarks (0 already existed, total: 20)
[X-Bookmarks-GraphQL] Downloaded 20 bookmarks to x-bookmarks-graphql-2025-10-15T04-56-07.json
📜 Auto-scroll 2/10000 - Scrolled to: 17792
```

**Incremental Update Mode:**
```
✅ Interceptor ready! Use window.bookmarkInterceptor
[X-Bookmarks-GraphQL] GraphQL interceptor installed
[X-Bookmarks-GraphQL] Loaded 30221 existing bookmark IDs
[X-Bookmarks-GraphQL] Auto-scroll will stop when encountering bookmarks that already exist
✅ Existing bookmarks loaded!

🚀 Starting auto-scroll in 3 seconds...
📜 Auto-scroll 1/10000 - Scrolled to: 8262
[X-Bookmarks-GraphQL] ✅ Captured 20 new bookmarks (0 already existed, total: 20)
📜 Auto-scroll 2/10000 - Scrolled to: 17792
[X-Bookmarks-GraphQL] ⏭️  Skipping existing bookmark: 1977089288895345130
[X-Bookmarks-GraphQL] ✅ Captured 14 new bookmarks (6 already existed, total: 34)
📜 Auto-scroll 3/10000 - Scrolled to: 25105
[X-Bookmarks-GraphQL] ⏭️  Skipping existing bookmark: 1977091670014300659
[X-Bookmarks-GraphQL] ⚠️  All 20 bookmarks in this batch already exist (consecutive: 1/5)
[X-Bookmarks-GraphQL] ⚠️  All 20 bookmarks in this batch already exist (consecutive: 5/5)
[X-Bookmarks-GraphQL] 🛑 Stopping auto-scroll: encountered 5 consecutive batches of existing bookmarks
🏁 Auto-scroll stopped: All recent bookmarks already exist in your collection.
📊 Captured 34 new bookmarks.
```

## 🛑 Manual Control (If Needed)

```javascript
// Check progress
window.bookmarkInterceptor.getBookmarkCount()

// Stop auto-scroll
window.bookmarkInterceptor.uninstall()

// Force save current data
window.bookmarkInterceptor.saveBookmarks()
```

## 📂 Finding Your Downloaded Files

Raw extraction files (`x-bookmarks-graphql-*.json`) are auto-downloaded to the Playwright session's download directory. Common locations:
- `.playwright-mcp/` directory in your project
- `~/Downloads/` folder
- `/var/folders/.../playwright-mcp-output/` (temporary directory)

Pass that path to Step 8 (`BOOKMARK_FILES_DIR="..."`) to merge them into `data/x-bookmarks-latest.json`.

To check progress during extraction:

```javascript
await mcp__playwright__browser_evaluate({
  function: `() => {
    const count = window.bookmarkInterceptor ? window.bookmarkInterceptor.getBookmarkCount() : 'N/A';
    const stopped = window.bookmarkInterceptor ? window.bookmarkInterceptor.shouldStopAutoScroll() : false;
    return \`New bookmarks: \${count}, Auto-scroll stopped: \${stopped}\`;
  }`,
  element: "Check extraction progress"
});
```

## 🎯 Results

- **Individual files**: `x-bookmarks-graphql-*.json` (real-time saves, in the browser download directory)
- **Canonical collection**: `data/x-bookmarks-latest.json` (merged by Step 8)
- **Combined outputs**: `data/x-bookmarks-combined-*.json` (full merged snapshots, one per run)
- **Backups**: `data/x-bookmarks-latest-backup-*.json` (written before every update; 5 newest kept automatically)

**Perfect for**: Backing up bookmarks, data analysis, building personal tools, archiving collections.

## 📊 Viewing Your Bookmarks

After extraction and combining, view your bookmarks in an interactive interface:

```bash
./view-bookmarks.sh
```

This will:
1. Start a local Python web server on port 8080
2. Open the bookmark viewer in your browser
3. Load your `data/x-bookmarks-latest.json` file

**Features:**
- Advanced search with AND/OR operators, exclusions, exact phrases
- Monthly bookmark timeline chart
- Trending terms and financial ticker detection
- Filter by year, engagement metrics, or media

Press `Ctrl+C` to stop the server when done.

---

## 🔧 Troubleshooting

### Why a seed file instead of injecting IDs from chat?

Injecting ~30k IDs (~650KB) through model-generated tool calls is slow,
expensive (~190k output tokens), and risks transcription errors. The seed file
+ `browser_run_code_unsafe` path moves the data disk→Node→page without the
model in the loop. The chunked fallback caps at 5,000 IDs to bound token cost;
it is a heuristic keyed on capture recency, so expect auto-stop to fire
slightly later than with the full set.

### Why not fetch the seed file from a local HTTP server?

x.com sends a strict `Content-Security-Policy: connect-src` allowlist that
does not include localhost. In-page `fetch('http://localhost:...')` is blocked
by CSP before CORS applies. (Verified 2026-07-11.)

### Browser Security Restrictions

**Problem**: Cannot use `fetch('file://...')` to load bookmark files in browser
- Browsers block file:// protocol for security (CORS policy)

**Solution**: Extract IDs via command line and inject directly as JavaScript arrays

### Response Size Limits

**Problem**: Complex object returns can exceed 25,000 token limits
- `browser_evaluate` with large objects fails
- `browser_console_messages` with many logs fails

**Solution**: Return simple strings instead of complex objects:
```javascript
// ❌ Avoid: Complex objects
return { count: X, bookmarks: [...], status: {...} };

// ✅ Prefer: Simple strings
return `New bookmarks: ${count}, Stopped: ${stopped}`;
```

### File Combining Performance

**Problem**: Combine script processes many duplicate files

**Solution**: The script automatically deduplicates. For large collections:
- First run may take 30-60 seconds
- Subsequent runs are faster
- ~20M duplicates are normal across historical runs

---

**🎉 Ready to extract your entire X bookmark collection? Just copy-paste the 3 steps above!**
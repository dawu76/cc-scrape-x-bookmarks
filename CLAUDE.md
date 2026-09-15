# X Bookmark Extractor - Complete Process

**Extract ALL your X (Twitter) bookmarks with real engagement metrics.**

## 🔄 Incremental Updates (Recommended!)

If you already have `data/x-bookmarks-latest.json`, you can capture only **new** bookmarks:

**Benefits:**
- Only captures NEW bookmarks you haven't saved yet
- Automatically stops scrolling after encountering 5 consecutive batches of existing bookmarks
- Saves time and bandwidth (seconds vs minutes)
- No need to scroll through tens of thousands of existing bookmarks

---

## 🚀 Complete Process

### Step 1: Navigate to X Bookmarks
```javascript
await mcp__playwright__browser_navigate({ url: "https://x.com/i/bookmarks" });
```

X redirects this to `https://x.com/i/history` with the **Bookmarks** tab
selected (seen 2026-09-14). That is expected. The page still loads bookmarks
through the `Bookmarks` GraphQL operation with the same response shape, so the
interceptor works unchanged.

### Step 2: User Login
Let user login with their X account. Wait for confirmation before continuing.

### Step 3: Install Interceptor, Then Load Bookmarks

The interceptor must be hooked **before** X requests the first page of
bookmarks. Injecting into an already-loaded page misses that page (your newest
~20 bookmarks), and switching History tabs does not refetch it because X
renders its cached timeline.

Generate the loader. It inlines `interceptor-no-autostart.js`, because the
tool's sandbox cannot read files:

```bash
bun build-interceptor-loader.ts
# ✅ Wrote interceptor loader to ./data/interceptor-loader.js
```

Optional arguments: `bun build-interceptor-loader.ts [interceptor] [loader]`,
defaulting to `./interceptor-no-autostart.js` and `./data/interceptor-loader.js`.

Run it from disk:

```javascript
await mcp__playwright__browser_run_code_unsafe({
  filename: "/Users/howardwu/dev/cc-scrape-x-bookmarks/data/interceptor-loader.js"
});
```

The loader registers the interceptor with `page.addInitScript` (runs before
X's own scripts on every page load, and is not blocked by x.com's CSP), calls
`install()` inside that init script, loads the bookmarks page, and waits up to
30s for the first `Bookmarks` response.

**MANDATORY verification:** the result must start with
`isActive: true, first page matched: true`. If it says
`first page matched: false`, the first `Bookmarks` response never arrived
(logged out, page error, or X renamed the operation). Check
`browser_network_requests` with filter `/graphql/` before continuing.

Notes:
- The first page arrives before seed IDs are loaded (Step 4), so all of its
  bookmarks count as new and are written to a batch file even if you already
  have them. The combine step deduplicates by ID, so this is harmless.
- **Do not navigate or reload after Step 4.** The init script builds a fresh
  interceptor on every page load, which discards the loaded seed IDs.
- **After changing `interceptor-no-autostart.js`, close the browser
  (`browser_close`) before running the loader.** Init scripts stay registered
  for the life of the browser session, and the injected code skips itself when
  `window.bookmarkInterceptor` already exists. So an older loader from earlier
  in the session runs first and the new code never loads (seen 2026-09-15).
  To check, evaluate
  `window.bookmarkInterceptor.extractQuotedTweet.toString()` and look for the
  change you made.
- If `browser_run_code_unsafe` is unavailable, paste the contents of
  `interceptor-no-autostart.js` into `browser_evaluate`, call
  `window.bookmarkInterceptor.install()`, and then recover the first page as
  described in Troubleshooting → "Recovering a missed first page".

### Step 4: Load Existing Bookmarks (For Incremental Updates)

**For first-time extraction: skip this step entirely.**

First, regenerate the seed file and note the count it prints:

```bash
bun export-seed-ids.ts
# ✅ Wrote <COUNT> seed IDs to ./data/seed-ids.json
```

Optional arguments: `bun export-seed-ids.ts [collection] [seed ids] [seed loader]`,
defaulting to `./data/x-bookmarks-latest.json`, `./data/seed-ids.json` and
`./data/seed-loader.js`.

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

To wait between checks, put the wait inside the evaluate
(`await new Promise(r => setTimeout(r, 90000));` before the `return`). Keep it
at 90s or less. An MCP call that runs longer than ~120s is moved to a
background task, and its result only arrives later as a notification.

For long runs (a full extraction takes about 2 hours), watch the download
directory from a background shell instead of polling the page. Run this with
`run_in_background`, after clearing old sentinels (Step 8's
`CLEANUP_BATCH_FILES=1` does that). It exits when the completion sentinel
appears, or early if no batch file has arrived for 10 minutes, which means a
crash or a stalled scroll:

```bash
cd .playwright-mcp
until ls x-bookmarks-DONE-*.json >/dev/null 2>&1; do
  newest=$(ls -t x-bookmarks-graphql-*.json 2>/dev/null | head -1)
  if [ -n "$newest" ] && [ $(( $(date +%s) - $(stat -f %m "$newest") )) -gt 600 ]; then
    echo "STALLED: no batch file for 10 minutes (newest: $newest)"; exit 2
  fi
  sleep 60
done
cat x-bookmarks-DONE-*.json
```

`stat -f %m` is the macOS form; on Linux use `stat -c %Y`.

If every batch stays 100% new for a long time, check whether the scroll has
simply not reached the previous run yet:

```bash
newest=$(ls -t .playwright-mcp/x-bookmarks-graphql-*.json | head -1)
jq -r '[.bookmarks[].timestamp] | "newest batch tweets: \(min) .. \(max)"' "$newest"
jq -r '[.bookmarks[].timestamp] | max | "collection newest tweet: \(.)"' data/x-bookmarks-latest.json
```

Batch tweets newer than the collection's newest tweet mean the previous run is
still further down the feed. That is expected; keep waiting.

### Step 8: Combine All Files

First confirm every captured bookmark reached disk. Browser downloads can be
dropped without any error (26 of 1,694 batches on 2026-09-15). The completion
sentinel's count must match the unique bookmarks in the batch files:

```bash
jq -r '.new_bookmarks' "$(ls .playwright-mcp/x-bookmarks-DONE-*.json | tail -1)"
cat .playwright-mcp/x-bookmarks-graphql-*.json | jq -s '[.[].bookmarks[].id] | unique | length'
```

If the second number is lower, recover the missing bookmarks from page memory
before combining (Troubleshooting → "Recovering lost batch saves"). The page
must still be open, so do this before closing or navigating the browser.

```bash
# Downloads land in the project's .playwright-mcp/ directory (verified 2026-09-14).
# Output goes to ./data/ (set OUTPUT_DIR to change it).
BOOKMARK_FILES_DIR="$PWD/.playwright-mcp" CLEANUP_BATCH_FILES=1 bun combine-bookmarks.ts
```

The canonical collection lives at `data/x-bookmarks-latest.json` and is merged
automatically on every run, so no copy step is needed. The script refuses to
shrink the collection and writes a timestamped backup before every update.

When a bookmark ID appears in more than one input, `mergeBookmark` in
`combine-bookmarks.ts` combines the copies. The canonical file is read first,
then batch files by name (oldest to newest), so the older copy is always
`existing`. The rules:
- Tweet data (`metrics`, `displayName`, `isVerified`, `media`, `quotedTweet`,
  and so on) takes the newer copy.
- `capturedAt` keeps the earliest value, so it stays an approximate bookmark
  date even after a full re-scrape.
- If the newer `quotedTweet` is `{ unavailable: true }` but the older copy has
  its text, the older copy is kept.

This runs on every incremental run, not only full re-scrapes, because the
first page is always re-captured (see Step 3).

`CLEANUP_BATCH_FILES=1` deletes the raw per-batch files and the completion
sentinel after a successful merge (they are redundant once
`x-bookmarks-latest.json` is updated). It only runs after a successful,
non-shrinking update, and never touches `x-bookmarks-latest.json`, combined
snapshots, or backups. Leaving it on keeps a stale sentinel from being
re-reported on the next run. Drop it only if you want to inspect the batch
files first.

**Verification:** "Final unique bookmarks" must be at least the collection's
size before this run, and at most that size plus the sentinel's
`new_bookmarks`. This holds for incremental and full runs alike. It is usually
below the sum: in incremental runs the first page is counted as new before seed
IDs load (see Step 3), and in full runs nearly every bookmark is already in the
collection.

Then continue to Step 9. Every run ends there.

### Step 9: Download Photos

```bash
bun download-media.ts
# 🖼️  <N> photos: <N> on disk, <N> known gone, <N> to download
# ✅ Media: downloaded <N> (<MB> MB), failed <N>, skipped <N>
```

Saves small-size photos (`?name=small`, at most 680px on the long side) from bookmarks and their quoted
tweets to `data/media/<media id>.<ext>`, 4 at a time. Videos and GIFs are not
downloaded; their JSON keeps the preview image URL and the tweet link.

**Run this on every run, right after Step 8.** It reads the
`data/x-bookmarks-latest.json` that Step 8 just wrote, so running it earlier
misses the new bookmarks. Re-runs fetch only photos not yet on disk, so after
an incremental run it downloads just the new photos.
Failures go to `data/media/failed.json` with the HTTP status. 403, 404 and 410
mean the image or tweet is gone and are never retried. Anything else (5xx,
timeouts, network errors, recorded as status 0) is retried on the next run.
`INPUT_FILE` and `MEDIA_DIR` override the default paths.

Image URLs stop working when a tweet is deleted, so the sooner a photo is
downloaded, the more likely it is to still exist.

## 📊 What You Get

- **All bookmarks** (not just 5-10 visible ones)
- **Real engagement metrics** (likes, retweets, replies, views)
- **Complete user data** (verification status, display names) 
- **Media attachments** (photos, videos)
- **Quoted tweets** (`quotedTweet`: id, author, display name, text, date, media; `null` for non-quotes)
- **Downloaded photos** (small size, in `data/media/`; Step 9)
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

// Stop auto-scroll after the current scroll. The sentinel will still say
// "All recent bookmarks already exist in your collection.", since this reuses
// the incremental stop flag.
window.bookmarkInterceptor.shouldStopScrolling = true

// Save any captured bookmarks not yet written to a batch file
window.bookmarkInterceptor.saveBookmarks()
```

`uninstall()` does **not** stop auto-scroll. It removes the network hooks, so
scrolling continues without capturing anything until the watchdog stops it and
writes a "Capture stall detected." sentinel.

## 📂 Finding Your Downloaded Files

Raw extraction files (`x-bookmarks-graphql-*.json`) are auto-downloaded to the
project's `.playwright-mcp/` directory (verified 2026-09-14), which is what
Step 8 uses. If a different Playwright setup saves them elsewhere, locate them
with:

```bash
find ~/Downloads .playwright-mcp /var/folders -maxdepth 6 -name 'x-bookmarks-graphql-*.json' -mmin -60 2>/dev/null | xargs -n1 dirname | sort | uniq -c
```

and pass that directory to Step 8 as `BOOKMARK_FILES_DIR`.

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

### Verifying a run finished (not interrupted)

Every completed auto-scroll writes one `x-bookmarks-DONE-*.json` sentinel to the
download directory. To confirm a run finished cleanly rather than being
interrupted (e.g., the laptop closed):

```bash
cat "$BOOKMARK_FILES_DIR"/x-bookmarks-DONE-*.json 2>/dev/null | tail -1
```

- `"reason": "All recent bookmarks already exist in your collection."` → clean incremental stop.
- `"reason": "Reached bottom of page."` → clean full stop.
- `"reason": "Maximum scroll limit reached."` → stopped after 10,000 scrolls
  without reaching the bottom. The batch files are valid, but the feed was not
  fully read; start a run with `startAutoScroll({ maxScrolls: 20000 })`.
- `"reason": "Capture stall detected."` → the interceptor was likely broken; investigate before trusting the batch.
- **No sentinel file at all** → the run did not finish; re-run before combining.

## 🎯 Results

- **Individual files**: `x-bookmarks-graphql-*.json` (real-time saves, in the browser download directory). Each file holds only the **new** bookmarks from that one batch (~20), not a cumulative snapshot — a full run is tens of MB total, not hundreds. The combine step deduplicates by ID, so overlapping or old cumulative files are harmless.
- **Canonical collection**: `data/x-bookmarks-latest.json` (merged by Step 8)
- **Combined outputs**: `data/x-bookmarks-combined-*.json` (full merged snapshots, one per run; 5 newest kept automatically)
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

## 🧪 Tests

```bash
bun test
```

Covers the interceptor (extraction, quoted tweets, auto-stop, batch saving,
sentinel, auto-scroll watchdog), `export-seed-ids.ts`, `combine-bookmarks.ts`
(merging, backups, retention, cleanup) and `download-media.ts` (against a local
test server, never X). `build-interceptor-loader.ts` and the viewer have no
tests. Run it after changing any script, then rebuild the loader (Step 3)
before the next browser run.

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

### Recovering a missed first page

Only needed when the interceptor was installed after the bookmarks page had
already loaded (the Step 3 fallback). The first `Bookmarks` response
(`count: 20`, no `cursor`) is still in Playwright's network log.

1. Find it with `browser_network_requests` and `filter: "/Bookmarks\\?"`. Use
   the entry whose `variables` have no `cursor`.
2. Save its body. The `filename` must be inside the project directory, since
   Playwright MCP refuses other paths (including the Claude scratchpad):
   ```javascript
   await mcp__playwright__browser_network_request({
     index: N, part: "response-body",
     filename: "/Users/howardwu/dev/cc-scrape-x-bookmarks/.playwright-mcp/first-page.json"
   });
   ```
3. Convert it into a normal batch file with the real extractor, dropping IDs
   you already have:
   ```bash
   bun -e '
   const fs = require("fs");
   const { BookmarkGraphQLInterceptor } = require("./interceptor-no-autostart.js");
   const seed = new Set(JSON.parse(fs.readFileSync("data/seed-ids.json", "utf8")).ids);
   const all = new BookmarkGraphQLInterceptor().extractBookmarksFromResponse(
     JSON.parse(fs.readFileSync(".playwright-mcp/first-page.json", "utf8")));
   const fresh = all.filter(b => !seed.has(b.id));
   fs.writeFileSync(".playwright-mcp/x-bookmarks-graphql-first-page.json", JSON.stringify(
     { exported_at: new Date().toISOString(), total_bookmarks: fresh.length,
       source: "graphql-interceptor", bookmarks: fresh }, null, 2));
   console.log(`extracted ${all.length}, new ${fresh.length}`);
   '
   rm .playwright-mcp/first-page.json
   ```

Step 8 merges that batch file like any other.

### Recovering lost batch saves

The interceptor keeps every bookmark it captured in memory until the page
closes. If Step 8's check shows fewer bookmarks on disk than the sentinel
reports, export them all into one extra batch file. `browser_evaluate` writes
the result itself through `filename`, so this avoids browser downloads:

```javascript
await mcp__playwright__browser_evaluate({
  function: `() => {
    const bookmarks = window.bookmarkInterceptor.getAllBookmarks();
    return { exported_at: new Date().toISOString(), total_bookmarks: bookmarks.length,
      source: 'graphql-interceptor-memory-dump', bookmarks };
  }`,
  element: "Export all captured bookmarks from page memory",
  filename: ".playwright-mcp/x-bookmarks-graphql-memory-dump.json"
});
```

The tool reply can exceed the response limit, because it lists every download
event from the run. That is expected. Check the file itself:

```bash
jq '{total_bookmarks, unique: ([.bookmarks[].id] | unique | length)}' .playwright-mcp/x-bookmarks-graphql-memory-dump.json
```

Both numbers must equal the sentinel's `new_bookmarks`. Step 8 then merges the
file like any other batch.

### Playwright MCP server crashes on the first batch download

With `@playwright/mcp` 0.0.81 (released 2026-09-14), the server died within a
second of the interceptor's first batch download, three times in a row: the
tool reply was `Connection closed`, the file never reached disk, and the
browser reset to `about:blank`. The MCP log (under
`~/Library/Caches/claude-cli-nodejs/<project>/mcp-logs-playwright/`) recorded
no error. 0.0.80 ran a full 1,694-batch extraction without a crash.

This project pins 0.0.80 in its local MCP config:

```bash
claude mcp remove playwright -s local
claude mcp add playwright -s local -- npx @playwright/mcp@0.0.80
```

Then run `/mcp` to reconnect. Before reconnecting after a crash, stop any
`playwright-mcp` process left over from this session, since it can keep the
browser profile locked. Try `@latest` again when a newer release is out.

### Backfilling quoted tweets (full re-scrape)

`quotedTweet` was added 2026-09-14. Bookmarks captured before then have no
`quotedTweet` field, and the raw responses are gone, so the only way to fill
them in is to fetch every bookmark again.

1. **Check the extractor against live data first.** The field names were
   confirmed against X's live responses on 2026-09-15, but X can change them.
   Do a normal incremental run (Steps 1-9 with `CLEANUP_BATCH_FILES` off) and
   confirm quote tweets in the batch files have text:
   ```bash
   jq '[.bookmarks[] | select(.isQuoteTweet)] | map(.quotedTweet)' .playwright-mcp/x-bookmarks-graphql-*.json
   ```
   If every entry is `null` or `unavailable`, save a `Bookmarks` response
   body (see "Recovering a missed first page") and fix `extractQuotedTweet`
   before continuing.
2. **Run Steps 1-3 and 5, skipping Step 4.** With no seed IDs, every bookmark
   counts as new and auto-stop (a) never fires, so the scroll runs to the
   bottom of the feed (~1,750 pages for ~35k bookmarks).
3. **Combine with Step 8.** `mergeBookmark` keeps each bookmark's original
   `capturedAt`, refreshes metrics, and fills in `quotedTweet`.
4. **Download photos with Step 9**, which now includes quoted tweets' photos.

Bookmarks you have since removed on X are not fetched again, so they keep no
`quotedTweet` field. Count what is still missing afterwards:

```bash
jq '[.bookmarks[] | select(.isQuoteTweet and (has("quotedTweet") | not))] | length' data/x-bookmarks-latest.json
```

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

**🎉 Ready to extract your entire X bookmark collection? Follow Steps 1-9 above.**
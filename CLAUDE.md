# X Bookmark Extractor - Complete Process

**Extract ALL your X (Twitter) bookmarks with real engagement metrics.**

## 🔄 Incremental Updates (Recommended!)

If you already have `x-bookmarks-latest.json`, you can capture only **new** bookmarks:

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

**Required inputs:**
- `x-bookmarks-latest.json` file path (absolute path)

**Approach:** Extract bookmark IDs from the existing file and inject them directly into the interceptor. This avoids file upload dialog issues.

```bash
# Extract just the bookmark IDs from existing file (more efficient than loading full file)
cat x-bookmarks-latest.json | jq -c '{bookmarks: [.bookmarks[] | {id: .id}]}'
```

Then inject the IDs directly into the browser:

```javascript
// Load existing bookmarks directly (replace BOOKMARK_IDS_JSON with output from jq command above)
await mcp__playwright__browser_evaluate({
  function: `() => {
    const existingBookmarks = BOOKMARK_IDS_JSON;
    if (window.bookmarkInterceptor) {
      window.bookmarkInterceptor.loadExistingBookmarks(existingBookmarks);
      console.log('✅ Existing bookmarks loaded!');
    }
  }`,
  element: "Load existing bookmark IDs"
});
```

**Note:** Claude Code will handle extracting the IDs and injecting them automatically. You don't need to manually copy-paste the JSON.

**Console output:**
```
[X-Bookmarks-GraphQL] Loaded 22540 existing bookmark IDs
[X-Bookmarks-GraphQL] Auto-scroll will stop when encountering bookmarks that already exist
✅ Existing bookmarks loaded!
```

**For first-time extraction:** Skip this step entirely.

### Step 5: Start Auto-Scroll Manually
```javascript
await mcp__playwright__browser_evaluate({
  function: `() => {
    let scrollCount = 0;
    const maxScrolls = 10000;
    const scrollDelay = 4000;

    function performScroll() {
      if (window.bookmarkInterceptor.shouldStopAutoScroll()) {
        console.log('🏁 Auto-scroll stopped: All recent bookmarks already exist.');
        console.log(\`📊 Captured \${window.bookmarkInterceptor.getBookmarkCount()} new bookmarks.\`);
        return;
      }
      if (scrollCount >= maxScrolls) return;

      const currentHeight = document.body.scrollHeight;
      window.scrollTo(0, currentHeight);
      scrollCount++;
      console.log(\`📜 Auto-scroll \${scrollCount}/\${maxScrolls} - Scrolled to: \${currentHeight}\`);

      setTimeout(() => {
        if (window.bookmarkInterceptor.shouldStopAutoScroll()) {
          console.log('🏁 Auto-scroll stopped: All recent bookmarks already exist.');
          console.log(\`📊 Captured \${window.bookmarkInterceptor.getBookmarkCount()} new bookmarks.\`);
          return;
        }
        if (document.body.scrollHeight === currentHeight) {
          console.log('🏁 Auto-scroll completed. Reached bottom of page.');
          console.log(\`📊 Captured \${window.bookmarkInterceptor.getBookmarkCount()} new bookmarks.\`);
          return;
        }
        performScroll();
      }, scrollDelay);
    }

    console.log('🚀 Starting auto-scroll in 3 seconds...');
    setTimeout(performScroll, 3000);
  }`,
  element: "Start auto-scroll function"
});
```

### Step 6: Monitor Auto-Extraction
The system auto-scrolls and captures bookmarks. Monitor progress via console messages.

### Step 7: Find Downloads Location
```javascript
await mcp__playwright__browser_evaluate({ 
  function: `() => {
    const count = window.bookmarkInterceptor ? window.bookmarkInterceptor.getBookmarkCount() : 'Not found';
    return \`Bookmark count: \${count}\`;
  }`, 
  element: "Check bookmark count and download location" 
});
```

### Step 8: Combine All Files (Optional)
```bash
# Files are auto-downloaded to Downloads folder
# Combine them if you have multiple extraction runs
BOOKMARK_FILES_DIR="~/Downloads" bun combine-bookmarks.ts

# Or specify custom Playwright output directory
BOOKMARK_FILES_DIR="/var/folders/.../playwright-mcp-output" bun combine-bookmarks.ts
```

### Step 9: Copy to Current Directory
```bash
# Copy the latest combined file back to project
cp ~/Downloads/x-bookmarks-latest.json ./
```

## 📊 What You Get

- **All bookmarks** (not just 5-10 visible ones)
- **Real engagement metrics** (likes, retweets, replies, views)
- **Complete user data** (verification status, display names) 
- **Media attachments** (photos, videos)
- **Timestamps and URLs**
- **Automatic deduplication**

## 🔄 Combine Multiple Files (Optional)

After extraction, combine all files into one:

```bash
# Run the combination script (searches ~/Downloads by default)
bun combine-bookmarks.ts

# Or specify a custom directory where your files are located
BOOKMARK_FILES_DIR="/var/folders/.../playwright-mcp-output" bun combine-bookmarks.ts
```

**Tip**: Use the JavaScript evaluation above to find your exact file location, then set `BOOKMARK_FILES_DIR` to that path.

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
📂 Select your x-bookmarks-latest.json file...
📖 Reading x-bookmarks-latest.json...
[X-Bookmarks-GraphQL] Loaded 22540 existing bookmark IDs
[X-Bookmarks-GraphQL] Auto-scroll will stop when encountering bookmarks that already exist
✅ Existing bookmarks loaded! Auto-scroll will now stop when it encounters them.

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

Before combining files, you can check where Playwright is saving the extracted bookmark files:

```javascript
// Use this in Claude Code to check download location and file count
await mcp__playwright__browser_evaluate({ 
  function: `() => {
    // Check current status only
    const count = window.bookmarkInterceptor ? window.bookmarkInterceptor.getBookmarkCount() : 'Not found';
    return \`Bookmark count: \${count}\`;
  }`, 
  element: "Check bookmark count only" 
});
```

This will show you both:
- Current bookmark count extracted
- The file download location (usually `/var/folders/.../playwright-mcp-output/`)

**Note**: Once you know the download location, update the `combine-bookmarks.ts` file to point to the correct directory before running the combination script.

## 🎯 Results

- **Individual files**: `x-bookmarks-graphql-*.json` (real-time saves)
- **Combined file**: `x-bookmarks-combined-*.json` (all bookmarks in one file)
- **Latest file**: `x-bookmarks-latest.json` (easy access to most recent)

**Perfect for**: Backing up bookmarks, data analysis, building personal tools, archiving collections.

## 📊 Viewing Your Bookmarks

After extraction and combining, view your bookmarks in an interactive interface:

```bash
./view-bookmarks.sh
```

This will:
1. Start a local Python web server on port 8080
2. Open the bookmark viewer in your browser
3. Load your `x-bookmarks-latest.json` file

**Features:**
- Advanced search with AND/OR operators, exclusions, exact phrases
- Monthly bookmark timeline chart
- Trending terms and financial ticker detection
- Filter by year, engagement metrics, or media

Press `Ctrl+C` to stop the server when done.

---

**🎉 Ready to extract your entire X bookmark collection? Just copy-paste the 3 steps above!**
# X Bookmark Extractor Reliability Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bookmark extraction pipeline execute reliably end-to-end: fix the syntax error that breaks injection, eliminate the localStorage quota failure that silently halts downloads, replace the flawed top-1000 seed-ID heuristic with exact full-ID loading, single-source the auto-scroll logic, and harden the combine script — each change locked in with automated verification.

**Architecture:** The system is a browser-injected GraphQL interceptor (`interceptor-no-autostart.js`) orchestrated via Playwright MCP tool calls documented in `CLAUDE.md`, plus a Bun merge script (`combine-bookmarks.ts`) and a static HTML viewer. The interceptor file will gain a CommonJS export guard so it can be unit-tested under `bun test` while remaining injectable as a plain script. Canonical data moves to a `data/` directory in the repo, removing the `~/Downloads` indirection.

**Tech Stack:** Vanilla browser JavaScript (injected), Bun + TypeScript (scripts and tests), `bun test` (no new dependencies), Playwright MCP (`browser_evaluate`, `browser_run_code_unsafe`), `jq`.

## Global Constraints

- `interceptor-no-autostart.js` must remain injectable as a plain script body wrapped in `() => { ${script} }`: **no `import`/`export` syntax, no top-level `await`**. CommonJS export must stay behind a `typeof module !== 'undefined'` guard, and all `window`/`document` access at the top level must be behind a `typeof window !== 'undefined'` guard.
- `node --check interceptor-no-autostart.js` must pass after **every** task that touches that file.
- Runtime is Bun (already required by the repo). Tests run with `bun test`. **No new npm dependencies; no `package.json` is required** (`bun test` auto-discovers `tests/*.test.{js,ts}`).
- **Never read `x-bookmarks-latest.json` (29MB) into model context.** Inspect it only through `jq` or scripts.
- Data safety: never delete or overwrite `data/x-bookmarks-latest.json` except through `combine-bookmarks.ts`'s existing guarded path (backup + refuse-to-shrink). Those guards must survive every refactor in this plan.
- Working branch: `features-20251014` (current). Commit at the end of every task with the exact message given in the task.
- All file paths below are relative to the repo root: `/Users/<username>/dev/cc-scrape-x-bookmarks`.

## Background: the defects being fixed (context for a fresh implementer)

1. **Syntax error:** `interceptor-no-autostart.js:502` contains `typeof module \!== 'undefined'` — a stray backslash (shell history-expansion escape artifact) that makes the whole file fail to parse. Injecting it verbatim throws `SyntaxError` and installs nothing. Lines 506–507 contain harmless-but-wrong `\!` inside strings.
2. **Silent download failure:** `saveBookmarks()` calls `localStorage.setItem` *before* `downloadBookmarks()` in one `try` block. localStorage caps at ~5–10MB; the collection serializes to ~29MB. Once captured data crosses the quota, `setItem` throws and the download never fires — a full re-extraction silently stops saving files. localStorage is a vestige of the userscript this was ported from (`loadBookmarks()` reads it back but nothing ever calls it). **Decision from review: delete localStorage entirely**, not reorder.
3. **Seed-ID heuristic is wrong-keyed:** incremental runs load only the "top 1,000" IDs from `x-bookmarks-latest.json`, but that file is sorted by tweet *creation* time (`combine-bookmarks.ts` sort), not bookmark recency. Recently-bookmarked old tweets miss the seed set, are counted "new," and reset the auto-stop counter — causing unbounded scroll time. **Decision from review: load ALL ~30k IDs.** Primary path: `mcp__playwright__browser_run_code_unsafe` reads a generated `seed-ids.json` from disk in the MCP's Node context and pushes it into the page via `page.evaluate` (one deterministic call; IDs never pass through the model; CDP `Runtime.evaluate` is not subject to page CSP). Fallback path: chunked `browser_evaluate` of the top 5,000 IDs sorted by `capturedAt`. **The local-HTTP-fetch approach is ruled out:** x.com's `Content-Security-Policy: connect-src` is an explicit allowlist with no `localhost`, so in-page fetch to a local server is blocked (verified 2026-07-11 via `curl -sL -D - https://x.com/`).
4. **Duplicated scroll logic:** the auto-scroll loop exists both as dead code (`startAutoScroll()` in the interceptor, never called) and as inline JS pasted into CLAUDE.md Step 5; the copies have already drifted. Single-source it in the file. Also add a **capture-stall watchdog**: currently "interceptor broken" and "no new bookmarks" are indistinguishable — scrolling proceeds forever while capturing nothing.
5. **XHR-only interception:** if X migrates bookmark GraphQL calls to `fetch`, capture silently drops to zero. Hook `fetch` alongside `XMLHttpRequest`.
6. **Combine script fragility:** shells out to `find` via `execSync` (quoting fragility), re-reads every historical combined file each run, and lets `x-bookmarks-latest-backup-*.json` files accumulate forever.
7. **Two sources of truth:** canonical data lives in `~/Downloads` (currently empty!) and gets copied to the repo root. Consolidate on `data/` inside the repo.

**Out of scope (separate plan):** the theme/sentiment summarization layer (date-range slice script + monthly theme summaries). It is a new feature with design choices needing user input, not a fix.

---

### Task 1: Fix the syntax error and make the interceptor testable

**Files:**
- Modify: `interceptor-no-autostart.js:450-509` (bottom-of-file block)
- Create: `tests/interceptor-load.test.js`

**Interfaces:**
- Produces: `module.exports = { BookmarkGraphQLInterceptor, startAutoScroll }` from `interceptor-no-autostart.js` — every later test file consumes this exact shape via `require('../interceptor-no-autostart.js')`.

- [ ] **Step 1: Write the failing test**

Create `tests/interceptor-load.test.js`:

```js
import { test, expect } from "bun:test";

test("interceptor file parses and exports the class", () => {
  const { BookmarkGraphQLInterceptor } = require("../interceptor-no-autostart.js");
  const i = new BookmarkGraphQLInterceptor();
  expect(i.getBookmarkCount()).toBe(0);
  expect(i.shouldStopAutoScroll()).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/interceptor-load.test.js`
Expected: FAIL — a `SyntaxError` (from the `\!==` at line 502) or a destructuring/undefined error, because the file cannot be required as-is.

Also run: `node --check interceptor-no-autostart.js`
Expected: `SyntaxError: Invalid or unexpected token` pointing at line 502.

- [ ] **Step 3: Fix the bottom-of-file block**

In `interceptor-no-autostart.js`, replace everything from the line `// Create global instance` (currently line 450) through the end of the file — **keeping the `startAutoScroll` function definition in between exactly as it is for now** (it is rewritten in Task 4) — so the surrounding block reads:

```js
// Create global instance (browser injection context only)
if (typeof window !== 'undefined') {
  window.bookmarkInterceptor = new BookmarkGraphQLInterceptor();
  window.startAutoScroll = startAutoScroll;
  console.log('✅ Interceptor ready! Use window.bookmarkInterceptor');
  console.log('🚀 To start auto-scroll: call startAutoScroll()');
}
```

Specifically:
1. Wrap the `window.bookmarkInterceptor = ...` assignment in the `typeof window !== 'undefined'` guard shown above, and add `window.startAutoScroll = startAutoScroll;` (injection wraps the file in an IIFE, so function declarations are not global unless attached to `window`). Note: `startAutoScroll` is *declared* later in the file — function declarations hoist, so referencing it here is safe. Place the guard block **after** the `startAutoScroll` function definition to keep reading order sane.
2. Replace the `module.exports` block at the bottom with:

```js
// Export for Node/Bun test usage (no-op in the browser)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BookmarkGraphQLInterceptor, startAutoScroll };
}
```

3. Delete the three trailing `console.log` lines containing `\!` (their content moved inside the window guard above, without backslashes).

- [ ] **Step 4: Verify parse and test pass**

Run: `node --check interceptor-no-autostart.js`
Expected: exit 0, no output.

Run: `grep -n '\\\\!' interceptor-no-autostart.js || echo CLEAN`
Expected: `CLEAN` (no remaining backslash-bang sequences).

Run: `bun test tests/interceptor-load.test.js`
Expected: `1 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add interceptor-no-autostart.js tests/interceptor-load.test.js
git commit -m "fix: repair syntax error in interceptor and add test scaffolding"
```

---

### Task 2: Remove localStorage entirely (fixes silent download failure)

**Files:**
- Modify: `interceptor-no-autostart.js` — `saveBookmarks()` (~line 328), `clearBookmarks()` (~line 384), delete `loadBookmarks()` (~lines 390–406)
- Create: `tests/interceptor-save.test.js`

**Interfaces:**
- Consumes: `module.exports = { BookmarkGraphQLInterceptor }` from Task 1.
- Produces: `saveBookmarks()` now *only* builds the export object and calls `this.downloadBookmarks(exportData)`. `loadBookmarks()` no longer exists. No behavior consumers elsewhere reference localStorage (verified: CLAUDE.md references only `saveBookmarks`, `getBookmarkCount`, `uninstall`, `loadExistingBookmarks`, `shouldStopAutoScroll`).

- [ ] **Step 1: Write the failing test**

Create `tests/interceptor-save.test.js`:

```js
import { test, expect } from "bun:test";
const { BookmarkGraphQLInterceptor } = require("../interceptor-no-autostart.js");

test("saveBookmarks downloads a snapshot without touching localStorage", () => {
  const i = new BookmarkGraphQLInterceptor();
  i.bookmarks.set("1", { id: "1", text: "hello" });

  let downloaded = null;
  i.downloadBookmarks = (data) => { downloaded = data; };

  // No localStorage exists in this test environment; if saveBookmarks still
  // references it, this call throws and the test fails.
  i.saveBookmarks();

  expect(downloaded).not.toBeNull();
  expect(downloaded.total_bookmarks).toBe(1);
  expect(downloaded.bookmarks[0].id).toBe("1");
});

test("loadBookmarks method has been removed", () => {
  const i = new BookmarkGraphQLInterceptor();
  expect(i.loadBookmarks).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/interceptor-save.test.js`
Expected: FAIL — first test throws `ReferenceError: localStorage is not defined` (or `Can't find variable`); second test fails because `loadBookmarks` is still defined.

- [ ] **Step 3: Implement**

Replace the entire `saveBookmarks()` method with:

```js
  // Save bookmarks by downloading a JSON snapshot (files on disk are the
  // durable store; the combine script recovers from partial runs)
  saveBookmarks() {
    const bookmarksList = Array.from(this.bookmarks.values());
    const exportData = {
      exported_at: new Date().toISOString(),
      total_bookmarks: bookmarksList.length,
      source: 'graphql-interceptor',
      bookmarks: bookmarksList
    };
    this.downloadBookmarks(exportData);
  }
```

In `clearBookmarks()`, delete the line `localStorage.removeItem('x-bookmarks-graphql-data');`.

Delete the entire `loadBookmarks()` method (the `// Load bookmarks from localStorage` block).

- [ ] **Step 4: Verify**

Run: `grep -c localStorage interceptor-no-autostart.js`
Expected: `0`.

Run: `node --check interceptor-no-autostart.js && bun test`
Expected: parse OK; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add interceptor-no-autostart.js tests/interceptor-save.test.js
git commit -m "fix: remove localStorage persistence that silently blocked downloads past quota"
```

---

### Task 3: Shared response processing + fetch() interception

**Files:**
- Modify: `interceptor-no-autostart.js` — constructor, `install()`, `uninstall()`, `handleBookmarkResponse()`
- Create: `tests/fixtures.js`, `tests/interceptor-capture.test.js`

**Interfaces:**
- Consumes: class export from Task 1.
- Produces:
  - `processResponseText(responseText, url)` — parses one GraphQL response body; increments `this.matchedRequestCount`; used by both XHR and fetch paths, and by Task 4's watchdog and tests.
  - `this.matchedRequestCount` (number, starts 0) — counts successfully parsed bookmark responses.
  - `installFetchHook()` / restoration in `uninstall()` via `this.originalFetch`.
  - `tests/fixtures.js` exports `makeBookmarkResponse(ids)` returning a realistic GraphQL bookmark payload — reused by Task 4 tests.

- [ ] **Step 1: Create the shared fixture builder**

Create `tests/fixtures.js`:

```js
// Builds a minimal-but-realistic Bookmarks GraphQL response for the given tweet IDs.
function makeBookmarkResponse(ids) {
  return {
    data: {
      bookmark_timeline_v2: {
        timeline: {
          instructions: [
            {
              type: "TimelineAddEntries",
              entries: ids.map((id) => ({
                entryId: `tweet-${id}`,
                content: {
                  entryType: "TimelineTimelineItem",
                  itemContent: {
                    __typename: "TimelineTweet",
                    tweet_results: {
                      result: {
                        __typename: "Tweet",
                        rest_id: String(id),
                        views: { count: "100" },
                        core: {
                          user_results: {
                            result: {
                              core: { screen_name: "trader", name: "Trader" },
                              verification: { verified: true }
                            }
                          }
                        },
                        legacy: {
                          id_str: String(id),
                          full_text: `tweet ${id}`,
                          created_at: "Thu Sep 28 11:07:25 +0000 2023",
                          reply_count: 1,
                          retweet_count: 2,
                          favorite_count: 3,
                          bookmark_count: 4,
                          is_quote_status: false
                        }
                      }
                    }
                  }
                }
              }))
            }
          ]
        }
      }
    }
  };
}

module.exports = { makeBookmarkResponse };
```

- [ ] **Step 2: Write the failing tests**

Create `tests/interceptor-capture.test.js`:

```js
import { test, expect } from "bun:test";
const { BookmarkGraphQLInterceptor } = require("../interceptor-no-autostart.js");
const { makeBookmarkResponse } = require("./fixtures.js");

const BOOKMARKS_URL = "https://x.com/i/api/graphql/abc123/Bookmarks?variables=%7B%7D";

function makeInterceptor() {
  const i = new BookmarkGraphQLInterceptor();
  i.saveBookmarks = () => {}; // downloads need a DOM; not under test here
  return i;
}

test("processResponseText captures bookmarks and counts matched requests", () => {
  const i = makeInterceptor();
  i.processResponseText(JSON.stringify(makeBookmarkResponse(["11", "12"])), BOOKMARKS_URL);
  expect(i.getBookmarkCount()).toBe(2);
  expect(i.matchedRequestCount).toBe(1);
  expect(i.getAllBookmarks()[0].username).toBe("trader");
});

test("existing IDs are skipped and 5 all-existing batches trigger auto-stop", () => {
  const i = makeInterceptor();
  i.loadExistingBookmarks({ bookmarks: [{ id: "1" }, { id: "2" }] });
  for (let n = 0; n < 5; n++) {
    i.processResponseText(JSON.stringify(makeBookmarkResponse(["1", "2"])), BOOKMARKS_URL);
  }
  expect(i.getBookmarkCount()).toBe(0);
  expect(i.shouldStopAutoScroll()).toBe(true);
});

test("a batch containing any new bookmark resets the consecutive counter", () => {
  const i = makeInterceptor();
  i.loadExistingBookmarks({ bookmarks: [{ id: "1" }] });
  for (let n = 0; n < 4; n++) {
    i.processResponseText(JSON.stringify(makeBookmarkResponse(["1"])), BOOKMARKS_URL);
  }
  expect(i.consecutiveExistingCount).toBe(4);
  i.processResponseText(JSON.stringify(makeBookmarkResponse(["1", "99"])), BOOKMARKS_URL);
  expect(i.consecutiveExistingCount).toBe(0);
  expect(i.shouldStopAutoScroll()).toBe(false);
});

test("chunked loadExistingBookmarks accumulates across calls", () => {
  const i = makeInterceptor();
  i.loadExistingBookmarks({ bookmarks: [{ id: "1" }, { id: "2" }] });
  i.loadExistingBookmarks({ bookmarks: [{ id: "3" }] });
  expect(i.existingBookmarkIds.size).toBe(3);
});

test("fetch hook captures bookmark responses and uninstall restores fetch", async () => {
  const i = makeInterceptor();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(makeBookmarkResponse(["21"])), { status: 200 });

  try {
    i.install();
    await globalThis.fetch(BOOKMARKS_URL);
    await Bun.sleep(20); // clone().text() resolves on a microtask/promise chain
    expect(i.getBookmarkCount()).toBe(1);

    i.uninstall();
    await globalThis.fetch(BOOKMARKS_URL); // hook gone: no further capture
    await Bun.sleep(20);
    expect(i.getBookmarkCount()).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/interceptor-capture.test.js`
Expected: FAIL — `processResponseText is not a function`, `matchedRequestCount` undefined, fetch-hook test captures nothing. (The auto-stop and accumulation tests may pass already via `handleBookmarkResponse`-independent paths — that is fine; the new-API tests must fail.)

- [ ] **Step 4: Implement**

4a. In the constructor, add:

```js
    this.originalFetch = null;
    this.matchedRequestCount = 0; // successfully parsed bookmark responses (any transport)
```

Also correct the comment on the threshold fields (they count *batches*, not bookmarks):

```js
    this.consecutiveExistingCount = 0; // consecutive batches where every bookmark already existed
    this.stopThreshold = 5; // stop after this many consecutive all-existing batches
```

4b. Split `handleBookmarkResponse` — it keeps only transport concerns and delegates:

```js
  // Handle bookmark GraphQL response (XHR transport)
  handleBookmarkResponse(xhr, method, url) {
    if (xhr.status !== 200) {
      this.warn(`Non-200 response for ${url}:`, xhr.status);
      return;
    }
    if (!xhr.responseText) {
      this.warn('Empty response for', url);
      return;
    }
    this.processResponseText(xhr.responseText, url);
  }

  // Transport-agnostic: parse one bookmark GraphQL response body
  processResponseText(responseText, url) {
    try {
      this.matchedRequestCount++;
      const json = JSON.parse(responseText);
      const newBookmarks = this.extractBookmarksFromResponse(json);
      // ... [MOVE the existing body of handleBookmarkResponse here VERBATIM:
      //      the `if (newBookmarks.length > 0)` block with the newCount/existingCount
      //      loop, the consecutive-existing logic, and the saveBookmarks() call] ...
    } catch (err) {
      this.error('Failed to parse bookmark response:', err);
      this.error('URL:', url);
      this.error('Response:', responseText?.substring(0, 500) + '...');
    }
  }
```

(The `[MOVE ...]` marker means relocating the existing lines 116–154 unchanged — it is a cut-and-paste, not new code. `xhr.responseText` in the old catch block becomes `responseText`.)

4c. In `install()`, wrap the existing XHR hook in a guard and add the fetch hook before `this.isActive = true;`:

```js
    if (typeof XMLHttpRequest !== 'undefined') {
      // ... existing XHR hooking code, unchanged ...
    } else {
      this.warn('XMLHttpRequest not available; skipping XHR hook');
    }

    this.installFetchHook();
```

4d. Add the new method:

```js
  // Install fetch() hook so capture survives an XHR->fetch migration by X
  installFetchHook() {
    if (typeof globalThis.fetch !== 'function') {
      this.warn('fetch not available; skipping fetch hook');
      return;
    }
    this.originalFetch = globalThis.fetch;
    const self = this;
    globalThis.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const resultPromise = self.originalFetch.apply(this, arguments);
      if (self.isBookmarkRequest(url)) {
        self.log('Detected bookmark GraphQL request (fetch):', url);
        resultPromise
          .then((response) => {
            if (response.status !== 200) {
              self.warn(`Non-200 fetch response for ${url}:`, response.status);
              return;
            }
            response
              .clone()
              .text()
              .then((text) => {
                if (text) self.processResponseText(text, url);
              })
              .catch((err) => self.error('Failed to read fetch response body:', err));
          })
          .catch(() => { /* network errors belong to the page, not the hook */ });
      }
      return resultPromise;
    };
  }
```

4e. In `uninstall()`, after restoring XHR, add:

```js
    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = null;
    }
```

- [ ] **Step 5: Verify**

Run: `node --check interceptor-no-autostart.js && bun test`
Expected: parse OK; **all** test files pass (including Tasks 1–2 tests — regression check).

- [ ] **Step 6: Commit**

```bash
git add interceptor-no-autostart.js tests/fixtures.js tests/interceptor-capture.test.js
git commit -m "feat: intercept fetch alongside XHR via shared response processing"
```

---

### Task 4: Single-source auto-scroll with capture-stall watchdog

**Files:**
- Modify: `interceptor-no-autostart.js` — replace the `startAutoScroll` function
- Modify: `CLAUDE.md` — Step 5 section
- Create: `tests/autoscroll.test.js`

**Interfaces:**
- Consumes: `window.bookmarkInterceptor` with `shouldStopAutoScroll()`, `getBookmarkCount()`, `matchedRequestCount` (Task 3); `window.startAutoScroll` attachment (Task 1).
- Produces: `startAutoScroll(options)` where `options = { maxScrolls?, scrollDelay?, startDelay?, stallLimit?, onStop? }`; `onStop(reason: string)` fires exactly once when scrolling ends. CLAUDE.md Step 5 calls `startAutoScroll()` with no arguments.

- [ ] **Step 1: Write the failing tests**

Create `tests/autoscroll.test.js`:

```js
import { test, expect, afterEach } from "bun:test";
const { startAutoScroll } = require("../interceptor-no-autostart.js");

function fakeEnvironment({ interceptor }) {
  let height = 0;
  globalThis.window = { bookmarkInterceptor: interceptor, scrollTo: () => {} };
  globalThis.document = {
    // strictly increasing height => "reached bottom" never fires
    body: { get scrollHeight() { height += 100; return height; } }
  };
}

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

function waitFor(getter, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = () => {
      const v = getter();
      if (v) return resolve(v);
      if (Date.now() - t0 > timeoutMs) return reject(new Error("timeout"));
      setTimeout(poll, 5);
    };
    poll();
  });
}

test("stops with stall reason when no bookmark responses are intercepted", async () => {
  let stopReason = null;
  fakeEnvironment({
    interceptor: { shouldStopAutoScroll: () => false, getBookmarkCount: () => 0, matchedRequestCount: 0 }
  });
  startAutoScroll({ startDelay: 1, scrollDelay: 1, stallLimit: 3, onStop: (r) => { stopReason = r; } });
  await waitFor(() => stopReason);
  expect(stopReason).toBe("Capture stall detected.");
});

test("stops when interceptor signals all-existing auto-stop", async () => {
  let stopReason = null;
  let calls = 0;
  fakeEnvironment({
    interceptor: {
      shouldStopAutoScroll: () => ++calls > 2, // stops on the 3rd check
      getBookmarkCount: () => 7,
      matchedRequestCount: 0
    }
  });
  startAutoScroll({ startDelay: 1, scrollDelay: 1, stallLimit: 100, onStop: (r) => { stopReason = r; } });
  await waitFor(() => stopReason);
  expect(stopReason).toBe("All recent bookmarks already exist in your collection.");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/autoscroll.test.js`
Expected: FAIL — current `startAutoScroll` takes no options, has a hardcoded 3000ms start delay and no `onStop`, so both tests time out or error.

- [ ] **Step 3: Replace `startAutoScroll` in `interceptor-no-autostart.js`**

Replace the entire existing `function startAutoScroll() { ... }` with:

```js
// Auto-scroll driver. Single source of truth — CLAUDE.md Step 5 calls this;
// do not paste a copy of this loop into documentation.
function startAutoScroll(options = {}) {
  const maxScrolls = options.maxScrolls || 10000;
  const scrollDelay = options.scrollDelay || 4000;
  const startDelay = options.startDelay || 3000;
  // Watchdog: if this many scrolls pass without a single intercepted bookmark
  // response, the interceptor is likely broken (e.g., X changed its API).
  const stallLimit = options.stallLimit || 10;
  const onStop = options.onStop || function () {};

  const interceptor = window.bookmarkInterceptor;
  let scrollCount = 0;
  let lastMatchedCount = interceptor.matchedRequestCount;
  let stalledScrolls = 0;
  let stopped = false;

  function finish(reason) {
    if (stopped) return;
    stopped = true;
    console.log(`🏁 Auto-scroll stopped: ${reason}`);
    console.log(`📊 Captured ${interceptor.getBookmarkCount()} new bookmarks.`);
    onStop(reason);
  }

  function performScroll() {
    if (interceptor.shouldStopAutoScroll()) {
      return finish('All recent bookmarks already exist in your collection.');
    }
    if (scrollCount >= maxScrolls) {
      return finish('Maximum scroll limit reached.');
    }

    if (interceptor.matchedRequestCount === lastMatchedCount) {
      stalledScrolls++;
      if (stalledScrolls >= stallLimit) {
        console.error(
          `🛑 No bookmark API responses intercepted in the last ${stallLimit} scrolls. ` +
          `The interceptor may be broken (X may have changed its API). Stopping.`
        );
        return finish('Capture stall detected.');
      }
    } else {
      stalledScrolls = 0;
      lastMatchedCount = interceptor.matchedRequestCount;
    }

    const currentHeight = document.body.scrollHeight;
    window.scrollTo(0, currentHeight);
    scrollCount++;
    console.log(`📜 Auto-scroll ${scrollCount}/${maxScrolls} - Scrolled to: ${currentHeight}`);

    setTimeout(() => {
      if (interceptor.shouldStopAutoScroll()) {
        return finish('All recent bookmarks already exist in your collection.');
      }
      if (document.body.scrollHeight === currentHeight) {
        return finish('Reached bottom of page.');
      }
      performScroll();
    }, scrollDelay);
  }

  console.log(`🚀 Starting auto-scroll in ${startDelay / 1000} seconds...`);
  setTimeout(performScroll, startDelay);
}
```

- [ ] **Step 4: Verify tests pass**

Run: `node --check interceptor-no-autostart.js && bun test`
Expected: parse OK; all tests pass.

- [ ] **Step 5: Replace CLAUDE.md Step 5**

In `CLAUDE.md`, replace the entire section from the heading `### Step 5: Start Auto-Scroll Manually` up to (not including) `### Step 6: Monitor Auto-Extraction` with:

````markdown
### Step 5: Start Auto-Scroll

The scroll loop lives in `interceptor-no-autostart.js` (`startAutoScroll`). Do not paste a copy of the loop here — just invoke it:

```javascript
await mcp__playwright__browser_evaluate({
  function: `() => { startAutoScroll(); return 'auto-scroll started'; }`,
  element: "Start auto-scroll"
});
```

It stops automatically when: (a) 5 consecutive batches contain only existing bookmarks (incremental mode), (b) the bottom of the page is reached, (c) the max scroll limit is hit, or (d) **watchdog**: 10 scrolls pass with zero intercepted bookmark responses — which means the interceptor is broken and the run must be investigated, not retried blindly.
````

- [ ] **Step 6: Verify the duplicate is gone**

Run: `grep -c "performScroll" CLAUDE.md`
Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add interceptor-no-autostart.js CLAUDE.md tests/autoscroll.test.js
git commit -m "feat: single-source auto-scroll with capture-stall watchdog"
```

---

### Task 5: Consolidate canonical data into `data/` (single source of truth)

**Files:**
- Create: `data/` (directory; move `x-bookmarks-latest.json` into it)
- Modify: `.gitignore`, `combine-bookmarks.ts` (output paths), `bookmark-viewer.html:472,481`, `view-bookmarks.sh`, `CLAUDE.md` (Steps 8–9)
- Create: `tests/combine.test.ts`

**Interfaces:**
- Consumes: existing `combine-bookmarks.ts` flow (input scan via `BOOKMARK_FILES_DIR`, guarded `latest.json` update).
- Produces: `OUTPUT_DIR` env var (default `./data`) controlling where `x-bookmarks-combined-*.json`, `x-bookmarks-latest.json`, and backups are written. Input scan **additionally always includes** `${OUTPUT_DIR}/x-bookmarks-latest.json` so incremental merges never lose the canonical collection. Viewer fetches `data/x-bookmarks-latest.json`. Task 6 defaults and Task 8 retention build on `OUTPUT_DIR = ./data`.

- [ ] **Step 1: Move the data file (verify it is untracked first)**

```bash
git check-ignore x-bookmarks-latest.json   # expected output: x-bookmarks-latest.json
mkdir -p data
mv x-bookmarks-latest.json data/
ls -lh data/x-bookmarks-latest.json        # expected: ~29M file present
```

Do NOT proceed if `git check-ignore` prints nothing (that would mean the file is tracked and needs `git mv` instead).

- [ ] **Step 2: Update `.gitignore`**

Replace the full contents of `.gitignore` with:

```gitignore
# Canonical bookmark data and derived artifacts (large, personal)
data/
x-bookmarks-latest.json

# Ignore generated injection script (contains all existing bookmarks)
injection-script.js

# Ignore playwright MCP output directory (contains all downloaded bookmark files)
.playwright-mcp/
```

Verify: `git status --short` shows only expected modified files (no `data/` entries).

- [ ] **Step 3: Write the failing combine integration test**

Create `tests/combine.test.ts`:

```ts
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function bookmark(id: string, ts: string) {
  return {
    id, url: `https://x.com/u/status/${id}`, username: "u", displayName: "U",
    isVerified: false, text: `t${id}`, timestamp: ts,
    metrics: { replies: 0, retweets: 0, likes: 0, bookmarks: 0, views: 0 },
    media: [], isRetweet: false, isQuoteTweet: false,
    capturedAt: ts, source: "graphql-api"
  };
}

function writeExport(path: string, bookmarks: object[]) {
  writeFileSync(path, JSON.stringify({
    exported_at: new Date().toISOString(),
    total_bookmarks: bookmarks.length,
    source: "graphql-interceptor",
    bookmarks
  }));
}

function runCombine(env: Record<string, string>) {
  const proc = Bun.spawnSync(["bun", "combine-bookmarks.ts"], {
    cwd: import.meta.dir + "/..",
    env: { ...process.env, ...env }
  });
  return { stdout: proc.stdout.toString(), code: proc.exitCode };
}

test("combines into OUTPUT_DIR and merges the canonical latest.json", () => {
  const inputDir = mkdtempSync(join(tmpdir(), "bm-in-"));
  const outputDir = mkdtempSync(join(tmpdir(), "bm-out-"));

  // canonical collection already has bookmark 1
  writeExport(join(outputDir, "x-bookmarks-latest.json"), [bookmark("1", "2026-01-01T00:00:00.000Z")]);
  // a new extraction run captured bookmark 2 (and 1 again — dedupe expected)
  writeExport(join(inputDir, "x-bookmarks-graphql-2026-07-11T00-00-00.json"),
    [bookmark("1", "2026-01-01T00:00:00.000Z"), bookmark("2", "2026-07-01T00:00:00.000Z")]);

  const { code } = runCombine({ BOOKMARK_FILES_DIR: inputDir, OUTPUT_DIR: outputDir });
  expect(code).toBe(0);

  const latest = JSON.parse(readFileSync(join(outputDir, "x-bookmarks-latest.json"), "utf8"));
  expect(latest.total_bookmarks).toBe(2);
  expect(latest.bookmarks[0].id).toBe("2"); // newest tweet first
});

test("canonical latest.json is always merged as input, so history never shrinks", () => {
  const inputDir = mkdtempSync(join(tmpdir(), "bm-in-"));
  const outputDir = mkdtempSync(join(tmpdir(), "bm-out-"));

  // canonical collection holds 3 bookmarks; the new run's input dir holds only 1
  writeExport(join(outputDir, "x-bookmarks-latest.json"),
    [bookmark("1", "2026-01-01T00:00:00.000Z"), bookmark("2", "2026-01-02T00:00:00.000Z"),
     bookmark("3", "2026-01-03T00:00:00.000Z")]);
  writeExport(join(inputDir, "x-bookmarks-graphql-new.json"), [bookmark("9", "2026-07-01T00:00:00.000Z")]);

  const { code } = runCombine({ BOOKMARK_FILES_DIR: inputDir, OUTPUT_DIR: outputDir });
  expect(code).toBe(0);

  const latest = JSON.parse(readFileSync(join(outputDir, "x-bookmarks-latest.json"), "utf8"));
  // 3 canonical + 1 new = 4; a naive input scan would have shrunk this to 1
  expect(latest.total_bookmarks).toBe(4);
  // a backup of the previous canonical file was written before the update
  const backups = require("fs").readdirSync(outputDir)
    .filter((f: string) => f.startsWith("x-bookmarks-latest-backup-"));
  expect(backups.length).toBe(1);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `bun test tests/combine.test.ts`
Expected: FAIL — `OUTPUT_DIR` is not honored yet (outputs land in `BOOKMARK_FILES_DIR`), and the canonical latest in `OUTPUT_DIR` is not scanned as input.

- [ ] **Step 5: Implement in `combine-bookmarks.ts`**

5a. After the `downloadsDir` definition (line ~66), add:

```ts
import { mkdirSync } from 'fs';   // add to imports at top of file

const outputDir = process.env.OUTPUT_DIR || './data';
mkdirSync(outputDir, { recursive: true });
```

5b. After the `files` array is built from the find scan (line ~73), add the canonical-latest guarantee:

```ts
// Always merge the canonical collection so incremental runs never drop history
const canonicalLatest = `${outputDir}/x-bookmarks-latest.json`;
if (await Bun.file(canonicalLatest).exists() && !files.includes(canonicalLatest)) {
  files.push(canonicalLatest);
}
```

Also move the `files.length === 0` early-exit check to **after** this push.

5c. Replace every output path that currently uses `downloadsDir` with `outputDir`:
- `const outputPath = `${outputDir}/x-bookmarks-combined-${timestamp}.json`;`
- `const latestPath = `${outputDir}/x-bookmarks-latest.json`;`
- both `backupPath` definitions: `` `${outputDir}/x-bookmarks-latest-backup-${timestamp}.json` ``

(`downloadsDir` remains input-only.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/combine.test.ts`
Expected: `2 pass`. Then run full suite: `bun test` — all pass.

- [ ] **Step 7: Point the viewer and server at `data/`**

In `bookmark-viewer.html` line ~472, change `fetch('x-bookmarks-latest.json')` to `fetch('data/x-bookmarks-latest.json')`, and in the error message at line ~481 change the text to `Make sure data/x-bookmarks-latest.json exists (run: bun combine-bookmarks.ts).`

In `view-bookmarks.sh`, insert after line 2 (before the server starts):

```bash
if lsof -i :8080 >/dev/null 2>&1; then
  echo "❌ Port 8080 is already in use. Stop the other process first (lsof -i :8080)."
  exit 1
fi
```

Verify manually:

```bash
./view-bookmarks.sh &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/data/x-bookmarks-latest.json  # expected: 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/bookmark-viewer.html          # expected: 200
kill %1
```

- [ ] **Step 8: Update CLAUDE.md Steps 8–9**

Replace the sections `### Step 8: Combine All Files (Optional)` and `### Step 9: Copy to Current Directory` (both headings and bodies) with a single section:

````markdown
### Step 8: Combine All Files

```bash
# Input: directory where the browser saved x-bookmarks-graphql-*.json downloads
# (check the Playwright session's download location). Output always goes to ./data/.
BOOKMARK_FILES_DIR="/path/to/downloads" bun combine-bookmarks.ts
```

The canonical collection lives at `data/x-bookmarks-latest.json` and is merged
automatically on every run — no copy step is needed. The script refuses to
shrink the collection and writes a timestamped backup before every update.
````

- [ ] **Step 9: Commit**

```bash
git add .gitignore combine-bookmarks.ts bookmark-viewer.html view-bookmarks.sh CLAUDE.md tests/combine.test.ts
git commit -m "feat: consolidate canonical bookmark data into data/ directory"
```

---

### Task 6: Seed-ID export script

**Files:**
- Create: `export-seed-ids.ts`
- Create: `tests/export-seed-ids.test.ts`

**Interfaces:**
- Consumes: `data/x-bookmarks-latest.json` (shape: `{ bookmarks: [{ id, capturedAt, ... }] }`).
- Produces: `bun export-seed-ids.ts [inputPath] [outputPath]` writing `data/seed-ids.json` with shape `{ generated_at: string, count: number, ids: string[] }`, **sorted by `capturedAt` descending** (newest capture first — this ordering is what makes the Task 7 fallback slice meaningful). Task 7's CLAUDE.md workflow consumes this file.

- [ ] **Step 1: Write the failing test**

Create `tests/export-seed-ids.test.ts`:

```ts
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

test("exports all IDs sorted by capturedAt descending", () => {
  const dir = mkdtempSync(join(tmpdir(), "seed-"));
  const input = join(dir, "latest.json");
  const output = join(dir, "seed-ids.json");
  writeFileSync(input, JSON.stringify({
    bookmarks: [
      { id: "old", capturedAt: "2025-01-01T00:00:00.000Z" },
      { id: "new", capturedAt: "2026-06-01T00:00:00.000Z" },
      { id: "mid", capturedAt: "2025-06-01T00:00:00.000Z" },
      { noId: true }
    ]
  }));

  const proc = Bun.spawnSync(["bun", "export-seed-ids.ts", input, output],
    { cwd: import.meta.dir + "/.." });
  expect(proc.exitCode).toBe(0);

  const seed = JSON.parse(readFileSync(output, "utf8"));
  expect(seed.count).toBe(3);
  expect(seed.ids).toEqual(["new", "mid", "old"]);
});

test("fails loudly on a missing input file", () => {
  const proc = Bun.spawnSync(["bun", "export-seed-ids.ts", "/nonexistent.json"],
    { cwd: import.meta.dir + "/.." });
  expect(proc.exitCode).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/export-seed-ids.test.ts`
Expected: FAIL — `export-seed-ids.ts` does not exist (spawn exits non-zero with module-not-found on the first test, and the equality assertions never run).

- [ ] **Step 3: Create `export-seed-ids.ts`**

```ts
#!/usr/bin/env bun
// Exports every bookmark ID from the canonical collection to a compact seed
// file, sorted by capturedAt descending (newest capture first). The incremental
// extraction workflow (CLAUDE.md Step 4) loads this file into the interceptor.

const inputPath = process.argv[2] || './data/x-bookmarks-latest.json';
const outputPath = process.argv[3] || './data/seed-ids.json';

const file = Bun.file(inputPath);
if (!(await file.exists())) {
  console.error(`❌ Input file not found: ${inputPath}`);
  process.exit(1);
}

const data = JSON.parse(await file.text());
if (!data.bookmarks || !Array.isArray(data.bookmarks)) {
  console.error(`❌ Invalid input: expected { bookmarks: [...] } in ${inputPath}`);
  process.exit(1);
}

const ids = data.bookmarks
  .filter((b: { id?: unknown }) => b && b.id)
  .sort((a: { capturedAt?: string }, b: { capturedAt?: string }) =>
    String(b.capturedAt || '').localeCompare(String(a.capturedAt || '')))
  .map((b: { id: unknown }) => String(b.id));

await Bun.write(outputPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  count: ids.length,
  ids
}));

console.log(`✅ Wrote ${ids.length} seed IDs to ${outputPath}`);
```

- [ ] **Step 4: Verify tests pass, then run against real data**

Run: `bun test tests/export-seed-ids.test.ts`
Expected: `2 pass`.

Run: `bun export-seed-ids.ts && jq '{count, first: .ids[0], generated_at}' data/seed-ids.json`
Expected: `count` equals `jq '.bookmarks | length' data/x-bookmarks-latest.json` (30221 as of plan-writing), and the command completes in under ~10 seconds.

- [ ] **Step 5: Commit**

```bash
git add export-seed-ids.ts tests/export-seed-ids.test.ts
git commit -m "feat: add seed-ID export script for incremental extraction"
```

---

### Task 7: Rewrite the incremental seed-loading workflow (CLAUDE.md Step 4)

**Files:**
- Modify: `CLAUDE.md` — Step 4 section and the Troubleshooting subsection "Why only load 1,000 recent bookmark IDs?"

**Interfaces:**
- Consumes: `data/seed-ids.json` (`{ count, ids }`, Task 6); `loadExistingBookmarks({ bookmarks: [{id}] })` accumulation semantics (verified by test in Task 3); `existingBookmarkIds` Set on the interceptor.
- Produces: documentation only — the executable workflow another Claude session follows.

- [ ] **Step 1: Replace CLAUDE.md Step 4**

Replace the entire section from `### Step 4: Load Existing Bookmarks (For Incremental Updates)` up to (not including) the `### Step 5` heading with:

````markdown
### Step 4: Load Existing Bookmarks (For Incremental Updates)

**For first-time extraction: skip this step entirely.**

First, regenerate the seed file and note the count it prints:

```bash
bun export-seed-ids.ts
# ✅ Wrote <COUNT> seed IDs to ./data/seed-ids.json
```

#### Primary path: `browser_run_code_unsafe` (loads ALL IDs, one call)

This reads the seed file from disk in the Playwright MCP's Node context and
pushes it into the page — the IDs never pass through the model, and CDP
evaluate is not subject to x.com's CSP.

```javascript
await mcp__playwright__browser_run_code_unsafe({
  code: `async (page) => {
    const fs = require('fs');
    const seed = JSON.parse(fs.readFileSync(
      '/Users/<username>/dev/cc-scrape-x-bookmarks/data/seed-ids.json', 'utf8'));
    await page.evaluate(() => {
      window.bookmarkInterceptor.existingBookmarkIds.clear();
    });
    for (let i = 0; i < seed.ids.length; i += 5000) {
      const chunk = seed.ids.slice(i, i + 5000);
      await page.evaluate((ids) => {
        window.bookmarkInterceptor.loadExistingBookmarks({
          bookmarks: ids.map(id => ({ id }))
        });
      }, chunk);
    }
    const size = await page.evaluate(
      () => window.bookmarkInterceptor.existingBookmarkIds.size);
    return 'Loaded ' + size + ' of ' + seed.count + ' seed IDs';
  }`
});
```

**MANDATORY verification:** the returned string must report `Loaded N of N`
with both numbers equal to the count printed by `export-seed-ids.ts`. If they
differ, or the tool errors, DO NOT start scrolling — fall back to the chunked
path below. Note: the exact `code` signature above matches @playwright/mcp's
convention of an async function receiving `page`; if the installed MCP version
rejects it, run the tool once with `code: "async (page) => page.url()"` to
discover the expected shape, adapt, and update this section.

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
````

- [ ] **Step 2: Replace the obsolete troubleshooting subsection**

In CLAUDE.md's Troubleshooting section, replace the subsection `### Why only load 1,000 recent bookmark IDs?` (heading plus its Problem/Solution body) with:

````markdown
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
````

- [ ] **Step 3: Verify with a live capability dry-run (no X login required)**

This validates the primary path mechanics against a neutral page:

1. `bun export-seed-ids.ts` — note the count (expect ~30,221).
2. Navigate a Playwright tab to `https://example.com`.
3. Inject a stub interceptor via `browser_evaluate`:
   ```javascript
   () => {
     window.bookmarkInterceptor = {
       existingBookmarkIds: new Set(),
       loadExistingBookmarks(d) { d.bookmarks.forEach(b => this.existingBookmarkIds.add(b.id)); }
     };
     return 'stub ready';
   }
   ```
4. Run the exact `browser_run_code_unsafe` call from Step 4's primary path.
5. Expected result: `Loaded 30221 of 30221 seed IDs` (numbers matching step 1). If the tool rejects the code shape, follow the adaptation note in the doc, fix the doc, and re-run until it passes.
6. Record the outcome in the commit message (worked as written / required adaptation X).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: replace top-1000 seed heuristic with full-ID loading via run_code_unsafe"
```

---

### Task 8: Combine script — shell-free file discovery and backup retention

**Files:**
- Modify: `combine-bookmarks.ts` — replace `execSync`/`find` with a recursive walker; add backup pruning
- Modify: `tests/combine.test.ts` — add discovery and retention tests

**Interfaces:**
- Consumes: `outputDir` / canonical-latest merge from Task 5.
- Produces: `findBookmarkFiles(rootDir: string): string[]` (internal function); retention policy: keep the **5 newest** `x-bookmarks-latest-backup-*.json` files in `outputDir`, delete older ones (ISO timestamps in filenames sort lexicographically = chronologically).

- [ ] **Step 1: Add failing tests to `tests/combine.test.ts`**

Append:

```ts
test("discovers bookmark files in nested directories without shelling out", () => {
  const inputDir = mkdtempSync(join(tmpdir(), "bm-in-"));
  const outputDir = mkdtempSync(join(tmpdir(), "bm-out-"));
  const nested = join(inputDir, "session-abc", "downloads");
  mkdirSync(nested, { recursive: true });
  writeExport(join(nested, "x-bookmarks-graphql-a.json"), [bookmark("1", "2026-01-01T00:00:00.000Z")]);
  writeExport(join(inputDir, "x-bookmarks-graphql-b.json"), [bookmark("2", "2026-01-02T00:00:00.000Z")]);
  // must be ignored: wrong names
  writeFileSync(join(inputDir, "x-bookmarks-latest-backup-2026.json"), "{}");
  writeFileSync(join(inputDir, "notes.json"), "{}");

  const { code } = runCombine({ BOOKMARK_FILES_DIR: inputDir, OUTPUT_DIR: outputDir });
  expect(code).toBe(0);
  const latest = JSON.parse(readFileSync(join(outputDir, "x-bookmarks-latest.json"), "utf8"));
  expect(latest.total_bookmarks).toBe(2);
});

test("prunes latest-backups down to the newest five", () => {
  const inputDir = mkdtempSync(join(tmpdir(), "bm-in-"));
  const outputDir = mkdtempSync(join(tmpdir(), "bm-out-"));
  writeExport(join(outputDir, "x-bookmarks-latest.json"), [bookmark("1", "2026-01-01T00:00:00.000Z")]);
  for (let d = 1; d <= 7; d++) {
    writeFileSync(join(outputDir, `x-bookmarks-latest-backup-2026-01-0${d}T00-00-00.json`), "{}");
  }
  writeExport(join(inputDir, "x-bookmarks-graphql-new.json"), [bookmark("2", "2026-07-01T00:00:00.000Z")]);

  const { code } = runCombine({ BOOKMARK_FILES_DIR: inputDir, OUTPUT_DIR: outputDir });
  expect(code).toBe(0);

  const backups = require("fs").readdirSync(outputDir)
    .filter((f: string) => f.startsWith("x-bookmarks-latest-backup-")).sort();
  expect(backups.length).toBe(5); // 7 old + 1 new from this run = 8, pruned to 5
  // the oldest three (01,02,03) must be the ones deleted
  expect(backups[0] > "x-bookmarks-latest-backup-2026-01-03").toBe(true);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun test tests/combine.test.ts`
Expected: the two new tests FAIL (backup file named `x-bookmarks-latest-backup-2026.json` currently confuses nothing, but retention does not exist so 8 backups remain; discovery currently passes via `find` — the retention test is the required failure). If the discovery test passes under `find`, that is acceptable; it exists to lock behavior across the rewrite.

- [ ] **Step 3: Implement**

3a. Remove `import { execSync } from 'child_process';` and add to the fs import: `import { mkdirSync, readdirSync, unlinkSync } from 'fs'; import { join } from 'path';`

3b. Replace the find-command block (the `findCommand`/`execSync`/`files` lines) with:

```ts
// Recursively find bookmark files without shelling out (no quoting pitfalls)
function findBookmarkFiles(rootDir: string): string[] {
  const results: string[] = [];
  const isBookmarkFile = (name: string) =>
    /^x-bookmarks-graphql-.*\.json$/.test(name) ||
    /^x-bookmarks-combined-.*\.json$/.test(name) ||
    name === 'x-bookmarks-latest.json';
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory: skip, matching find's tolerance
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && isBookmarkFile(entry.name)) results.push(full);
    }
  };
  walk(rootDir);
  return results;
}

const files = findBookmarkFiles(downloadsDir);
```

(The canonical-latest push from Task 5 stays immediately after this.)

3c. At the very end of the guarded latest-update block (after `console.log(\`🔗 Latest file updated...\`)`, still inside the `else` branch of the zero-bookmarks check), add:

```ts
    // Retention: keep only the 5 newest latest-backups (ISO names sort chronologically)
    const BACKUPS_TO_KEEP = 5;
    const backups = readdirSync(outputDir)
      .filter((f) => /^x-bookmarks-latest-backup-.*\.json$/.test(f))
      .sort();
    for (const oldBackup of backups.slice(0, Math.max(0, backups.length - BACKUPS_TO_KEEP))) {
      unlinkSync(join(outputDir, oldBackup));
      console.log(`🧹 Pruned old backup: ${oldBackup}`);
    }
```

- [ ] **Step 4: Verify**

Run: `bun test`
Expected: ALL tests pass (Tasks 1–6 tests are the regression net for this refactor).

Run: `grep -c execSync combine-bookmarks.ts`
Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add combine-bookmarks.ts tests/combine.test.ts
git commit -m "refactor: shell-free file discovery and backup retention in combine script"
```

---

### Task 9: Reconcile satellite docs with the new workflow

**Files:**
- Modify: `INCREMENTAL-UPDATE-GUIDE.md`, `COMMANDS_REFERENCE.md`, `README.md`

**Interfaces:**
- Consumes: final workflow shape from Tasks 4, 5, 7.
- Produces: satellite docs that cannot drift, because they point to CLAUDE.md instead of duplicating it.

- [ ] **Step 1: Replace `INCREMENTAL-UPDATE-GUIDE.md` contents entirely with:**

```markdown
# Incremental Update Guide

The executable, always-current workflow lives in [CLAUDE.md](CLAUDE.md) —
follow Steps 1–8 there. This file intentionally contains no copies of the
commands, because duplicated instructions drift (a stale copy of the scroll
loop in this repo once masked a syntax error for months).

Quick orientation:
- **Seed loading** (Step 4): `bun export-seed-ids.ts`, then the
  `browser_run_code_unsafe` primary path with the chunked fallback.
- **Auto-stop**: scrolling halts after 5 consecutive all-existing batches, at
  page bottom, or when the capture-stall watchdog fires.
- **Merging** (Step 8): `bun combine-bookmarks.ts` — canonical data is
  `data/x-bookmarks-latest.json`; the script refuses to shrink it and keeps
  the 5 newest backups.
```

- [ ] **Step 2: Update `COMMANDS_REFERENCE.md`**

Read the file first. Delete any code block that duplicates CLAUDE.md workflow steps (interceptor injection, ID loading, auto-scroll). Keep only genuinely reference material (viewer usage, jq one-liners), and add at the top:

```markdown
> **Workflow commands live in [CLAUDE.md](CLAUDE.md).** This file holds only
> supplementary one-liners; if it disagrees with CLAUDE.md, CLAUDE.md wins.
```

Update any surviving references to `x-bookmarks-latest.json` in the repo root to `data/x-bookmarks-latest.json`, and any `BOOKMARK_FILES_DIR` examples to mention `OUTPUT_DIR` defaulting to `./data`.

- [ ] **Step 3: Update `README.md`**

Read the file first. Fix stale paths (`x-bookmarks-latest.json` → `data/x-bookmarks-latest.json`) and remove any duplicated workflow steps in favor of a pointer to CLAUDE.md. Do not restructure otherwise.

- [ ] **Step 4: Verify no stale references remain**

Run: `grep -rn "x-bookmarks-latest.json" --include="*.md" --include="*.html" --include="*.sh" --include="*.ts" . | grep -v "data/x-bookmarks-latest.json" | grep -v docs/superpowers | grep -v CHANGELOG`
Expected: no output (every live reference now goes through `data/`). `CHANGELOG-FIXES.md` is historical and exempt.

Run: `bun test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add INCREMENTAL-UPDATE-GUIDE.md COMMANDS_REFERENCE.md README.md
git commit -m "docs: point satellite docs at CLAUDE.md and fix stale data paths"
```

---

## Final End-to-End Verification (requires the user, ~20 minutes)

Automated tests cannot log into X. After all tasks are merged, run one live incremental extraction with the user present:

- [ ] 1. `bun test` — all green; `node --check interceptor-no-autostart.js` — exit 0.
- [ ] 2. Follow CLAUDE.md Steps 1–3 (navigate, user logs in, inject interceptor). Expected console: `✅ Interceptor ready!` and `GraphQL interceptor installed` — if injection throws SyntaxError, Task 1 regressed.
- [ ] 3. Step 4 primary path. Expected: `Loaded 30221 of 30221 seed IDs` (count from `export-seed-ids.ts`, which will be ≥30,221 by then).
- [ ] 4. Step 5. Expected: scrolling starts, batches log `✅ Captured N new bookmarks`. **Note:** the collection is ~5.5 months stale (data ends 2026-01-29; ~600 bookmarks/month ≈ 3,300 pending ≈ 165 batches ≈ ~12 minutes at 4s/scroll). Auto-stop fires with `🛑 Stopping auto-scroll: encountered 5 consecutive batches of existing bookmarks`.
- [ ] 5. Confirm the watchdog did NOT fire (`Capture stall detected.` absent from console). If it fired, debug interception before anything else — do not re-run blindly.
- [ ] 6. Step 8: `BOOKMARK_FILES_DIR=<download dir> bun combine-bookmarks.ts`. Expected: final count > 30,221; `data/x-bookmarks-latest.json` updated; ≤5 backups in `data/`.
- [ ] 7. `./view-bookmarks.sh` — viewer loads, chart shows bars for 2026-02 through the present (the previously missing months).
- [ ] 8. Sanity: `jq '{total: .total_bookmarks, newest: .bookmarks[0].timestamp}' data/x-bookmarks-latest.json` — newest timestamp within the last few days.

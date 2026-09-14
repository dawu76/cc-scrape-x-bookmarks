# Extractor Efficiency & Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut extraction disk/compute cost ~100× by writing per-batch deltas instead of cumulative snapshots, and make interrupted runs detectable and cleanable.

**Architecture:** Three surfaces change. (1) The browser interceptor (`interceptor-no-autostart.js`) stops re-writing the entire accumulated bookmark Map on every save and instead writes only the bookmarks captured since the last successful save, clearing that buffer only when the download succeeds. (2) The interceptor writes a small `x-bookmarks-DONE-*.json` completion sentinel when auto-scroll stops, recording the stop reason and counts. (3) The combine script (`combine-bookmarks.ts`) reads that sentinel to warn when a run looks interrupted, and gains an opt-in cleanup of the now-consumed batch files. Batch-file shape is unchanged (`{exported_at,total_bookmarks,source,bookmarks[]}`), so the combine merge and its dedup-by-ID stay backward compatible with old cumulative files.

**Tech Stack:** Bun (TypeScript + JS ESM/CJS interop), `bun test`, browser CDP-injected vanilla JS. No new dependencies.

## Global Constraints

- **Data safety:** Never read `data/x-bookmarks-latest.json` (~34MB) into model context — inspect only via `jq` or scripts.
- **Data safety:** Never delete or overwrite `data/x-bookmarks-latest.json` except through `combine-bookmarks.ts`'s existing guarded path (timestamped backup + refuse-to-shrink).
- **CSP constraint:** `interceptor-no-autostart.js` must remain a single self-contained file with no new imports or runtime dependencies — it is injected into an X.com page whose CSP blocks external/inline script tags; the file is eval'd via CDP.
- **Durable store:** The per-batch `x-bookmarks-graphql-*.json` files and the new `x-bookmarks-DONE-*.json` sentinel are the only durable record between capture and combine; treat them as recoverable state, not scratch.
- **Batch file schema is a contract:** `combine-bookmarks.ts` consumes `{ bookmarks: [...] }` and dedups by `bookmark.id`. Do not change field names inside a bookmark.
- **Runtime:** Bun only. All tests run with `bun test`.
- **Backward compatibility:** A `.playwright-mcp/` directory may contain a mix of old cumulative batch files and new delta batch files. Combine must produce the correct union either way (it already dedups by ID).

---

### Task 1: Delta-save with failure-safe buffering (interceptor)

Today `saveBookmarks()` serializes the entire `this.bookmarks` Map on every batch that has any new bookmark, so batch file #190 re-contains all 3,807 bookmarks (measured: 477MB of files, 394,788 processed entries for 3,807 unique — ~103× waste). This task makes each batch file contain only that batch's new bookmarks, and makes a failed download retry on the next save instead of silently dropping a batch.

**Files:**
- Modify: `interceptor-no-autostart.js` — constructor (~line 16), `processResponseText` else-branch (~lines 176-179), `saveBookmarks` (~lines 378-387), `downloadBookmarks` (~lines 390-411)
- Modify (test): `tests/interceptor-save.test.js` — update the existing snapshot test; add delta/buffer tests
- Docs: `CLAUDE.md` — "🎯 Results" section note on file sizes

**Interfaces:**
- Consumes: existing `this.bookmarks` (Map, insertion-ordered), `processResponseText` capture loop, `this.log`/`this.error`.
- Produces:
  - `this.unsavedBookmarks: Array` — delta buffer of bookmarks captured but not yet persisted.
  - `saveBookmarks(): void` — writes only `this.unsavedBookmarks`; no-op when empty; clears the buffer only on a successful download.
  - `downloadBookmarks(exportData): boolean` — now returns `true` on success, `false` on caught error (was `void`).

- [ ] **Step 1: Update the existing save test to the delta contract, and add new tests**

Replace the first test in `tests/interceptor-save.test.js` and add three below it. The full file becomes:

```js
import { test, expect } from "bun:test";
const { BookmarkGraphQLInterceptor } = require("../interceptor-no-autostart.js");
const { makeBookmarkResponse } = require("./fixtures.js");

test("saveBookmarks downloads the delta buffer without touching localStorage", () => {
  const i = new BookmarkGraphQLInterceptor();
  i.unsavedBookmarks.push({ id: "1", text: "hello" });

  let downloaded = null;
  i.downloadBookmarks = (data) => { downloaded = data; return true; };

  // No localStorage exists in this test environment; if saveBookmarks still
  // references it, this call throws and the test fails.
  i.saveBookmarks();

  expect(downloaded).not.toBeNull();
  expect(downloaded.total_bookmarks).toBe(1);
  expect(downloaded.bookmarks[0].id).toBe("1");
});

test("saveBookmarks writes only the delta and clears the buffer on success", () => {
  const i = new BookmarkGraphQLInterceptor();
  const files = [];
  i.downloadBookmarks = (data) => { files.push(data); return true; };

  i.unsavedBookmarks.push({ id: "1" }, { id: "2" });
  i.saveBookmarks();
  i.unsavedBookmarks.push({ id: "3" });
  i.saveBookmarks();

  expect(files.length).toBe(2);
  expect(files[0].bookmarks.map((b) => b.id)).toEqual(["1", "2"]);
  expect(files[1].bookmarks.map((b) => b.id)).toEqual(["3"]); // delta only, not cumulative
});

test("saveBookmarks with an empty buffer does not download", () => {
  const i = new BookmarkGraphQLInterceptor();
  let called = false;
  i.downloadBookmarks = () => { called = true; return true; };
  i.saveBookmarks();
  expect(called).toBe(false);
});

test("a failed download keeps the buffer so the next save retries it", () => {
  const i = new BookmarkGraphQLInterceptor();
  const files = [];
  let succeed = false;
  i.downloadBookmarks = (data) => {
    if (!succeed) return false;
    files.push(data);
    return true;
  };

  i.unsavedBookmarks.push({ id: "1" });
  i.saveBookmarks();                       // fails: buffer retained
  expect(i.unsavedBookmarks.length).toBe(1);

  succeed = true;
  i.unsavedBookmarks.push({ id: "2" });
  i.saveBookmarks();                       // succeeds: both flushed together
  expect(files.length).toBe(1);
  expect(files[0].bookmarks.map((b) => b.id)).toEqual(["1", "2"]);
  expect(i.unsavedBookmarks.length).toBe(0);
});

test("processResponseText buffers only genuinely-new bookmarks for the delta", () => {
  const i = new BookmarkGraphQLInterceptor();
  i.saveBookmarks = () => {}; // don't flush; inspect the raw buffer
  i.loadExistingBookmarks({ bookmarks: [{ id: "1" }] });
  i.processResponseText(JSON.stringify(makeBookmarkResponse(["1", "2"])), "u/Bookmarks");
  expect(i.unsavedBookmarks.map((b) => b.id)).toEqual(["2"]); // "1" already existed
});

test("loadBookmarks method has been removed", () => {
  const i = new BookmarkGraphQLInterceptor();
  expect(i.loadBookmarks).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/interceptor-save.test.js`
Expected: FAIL — `i.unsavedBookmarks` is `undefined` (cannot `.push`), and the delta/empty-buffer/retry tests fail because `saveBookmarks` still serializes the whole Map and `downloadBookmarks` returns `undefined`.

- [ ] **Step 3: Add the delta buffer in the constructor**

In `interceptor-no-autostart.js`, in the constructor, immediately after `this.stopThreshold = 5;`:

```js
    this.stopThreshold = 5; // stop after this many consecutive all-existing batches
    this.unsavedBookmarks = []; // delta buffer: new bookmarks not yet written to disk
```

- [ ] **Step 4: Push each newly-captured bookmark into the buffer**

In `processResponseText`, in the `else` branch that records a new bookmark (currently `this.bookmarks.set(bookmark.id, bookmark); newCount++;`), add the buffer push:

```js
          } else {
            this.bookmarks.set(bookmark.id, bookmark);
            this.unsavedBookmarks.push(bookmark);
            newCount++;
          }
```

- [ ] **Step 5: Rewrite `saveBookmarks` to persist only the delta**

Replace the whole `saveBookmarks()` method body:

```js
  // Save bookmarks by downloading a JSON snapshot of only the bookmarks
  // captured since the last successful save (a delta). Files on disk are the
  // durable store; the combine script deduplicates by ID and recovers from
  // partial runs. The buffer is cleared only when the download succeeds, so a
  // failed save is retried in the next batch instead of being lost.
  saveBookmarks() {
    if (this.unsavedBookmarks.length === 0) return;
    const exportData = {
      exported_at: new Date().toISOString(),
      total_bookmarks: this.unsavedBookmarks.length,
      source: 'graphql-interceptor',
      bookmarks: this.unsavedBookmarks
    };
    if (this.downloadBookmarks(exportData)) {
      this.unsavedBookmarks = [];
    }
  }
```

- [ ] **Step 6: Make `downloadBookmarks` report success**

In `downloadBookmarks(exportData)`, add `return true;` after the success `this.log(...)` line, and `return false;` in the `catch`:

```js
      this.log(`Downloaded ${exportData.total_bookmarks} bookmarks to ${filename}`);
      return true;
    } catch (err) {
      this.error('Failed to download bookmarks:', err);
      return false;
    }
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test tests/interceptor-save.test.js tests/interceptor-capture.test.js`
Expected: PASS — both files. (`interceptor-capture.test.js` stubs `saveBookmarks` and asserts on the Map via `getBookmarkCount()`, so it stays green and confirms no regression in the capture path.)

- [ ] **Step 8: Document the smaller files in CLAUDE.md**

In `CLAUDE.md`, under "## 🎯 Results", change the "Individual files" bullet to:

```markdown
- **Individual files**: `x-bookmarks-graphql-*.json` (real-time saves, in the browser download directory). Each file holds only the **new** bookmarks from that one batch (~20), not a cumulative snapshot — a full run is tens of MB total, not hundreds. The combine step deduplicates by ID, so overlapping or old cumulative files are harmless.
```

- [ ] **Step 9: Commit**

```bash
git add interceptor-no-autostart.js tests/interceptor-save.test.js CLAUDE.md
git commit -m "perf: write per-batch bookmark deltas instead of cumulative snapshots

saveBookmarks now persists only bookmarks captured since the last
successful download and clears that buffer only on success, so a failed
save is retried rather than dropped. Cuts extraction disk/compute ~100x."
```

---

### Task 2: Completion sentinel on auto-scroll stop (interceptor)

When the laptop closed mid-session there was no on-disk way to tell a finished run from an interrupted one. This task writes a small `x-bookmarks-DONE-*.json` sentinel whenever the auto-scroll driver stops — for any reason, including the watchdog stall — recording the reason and counts. It also extracts the duplicated blob-download plumbing (now used by two callers) into one helper.

**Files:**
- Modify: `interceptor-no-autostart.js` — add `downloadJSON` helper, refactor `downloadBookmarks` to use it, add `writeCompletionSentinel`, call it from `startAutoScroll`'s `finish()` (~lines 488-494)
- Create (test): `tests/interceptor-sentinel.test.js`
- Modify (test): `tests/autoscroll.test.js` — extend the two fake interceptors; add a sentinel-on-stop test
- Docs: `CLAUDE.md` — Step 5 / "Finding Your Downloaded Files" verification note

**Interfaces:**
- Consumes: `this.bookmarks` (Map), `this.matchedRequestCount`, `this.log`/`this.error`; `startAutoScroll`'s `finish(reason)` and its `interceptor` handle.
- Produces:
  - `downloadJSON(data, filename): boolean` — triggers a browser download of `data` as `filename`; returns `true` on success, `false` on caught error.
  - `writeCompletionSentinel(reason): boolean` — downloads `x-bookmarks-DONE-<timestamp>.json` with this exact shape (the contract Task 3 reads):
    ```json
    {
      "status": "complete",
      "reason": "<stop reason string>",
      "new_bookmarks": 3807,
      "matched_requests": 196,
      "completed_at": "2026-07-11T09:53:04.000Z"
    }
    ```
  - `startAutoScroll`'s `finish()` calls `interceptor.writeCompletionSentinel(reason)` before `onStop(reason)`. Any fake interceptor passed to `startAutoScroll` must therefore provide `writeCompletionSentinel`.

- [ ] **Step 1: Write the sentinel unit tests**

Create `tests/interceptor-sentinel.test.js`:

```js
import { test, expect } from "bun:test";
const { BookmarkGraphQLInterceptor } = require("../interceptor-no-autostart.js");

test("writeCompletionSentinel emits a DONE payload with counts and reason", () => {
  const i = new BookmarkGraphQLInterceptor();
  i.bookmarks.set("1", { id: "1" });
  i.bookmarks.set("2", { id: "2" });
  i.matchedRequestCount = 7;

  let file = null;
  let name = null;
  i.downloadJSON = (data, filename) => { file = data; name = filename; return true; };

  const ok = i.writeCompletionSentinel("All recent bookmarks already exist in your collection.");
  expect(ok).toBe(true);
  expect(name).toMatch(/^x-bookmarks-DONE-.*\.json$/);
  expect(file.status).toBe("complete");
  expect(file.new_bookmarks).toBe(2);
  expect(file.matched_requests).toBe(7);
  expect(file.reason).toBe("All recent bookmarks already exist in your collection.");
});

test("downloadBookmarks and writeCompletionSentinel share downloadJSON", () => {
  const i = new BookmarkGraphQLInterceptor();
  const names = [];
  i.downloadJSON = (data, filename) => { names.push(filename); return true; };

  i.downloadBookmarks({ total_bookmarks: 1, bookmarks: [{ id: "1" }] });
  i.writeCompletionSentinel("done");

  expect(names[0]).toMatch(/^x-bookmarks-graphql-/);
  expect(names[1]).toMatch(/^x-bookmarks-DONE-/);
});
```

- [ ] **Step 2: Add the sentinel-on-stop test and update the fakes in autoscroll.test.js**

In `tests/autoscroll.test.js`, add `writeCompletionSentinel: () => true` to **both** existing fake interceptors (in "stops with stall reason…" and "stops when interceptor signals all-existing…"), then append this test:

```js
test("writes a completion sentinel when auto-scroll stops", async () => {
  let stopReason = null;
  let sentinelReason = null;
  fakeEnvironment({
    interceptor: {
      shouldStopAutoScroll: () => true,
      getBookmarkCount: () => 3,
      matchedRequestCount: 0,
      writeCompletionSentinel: (r) => { sentinelReason = r; return true; }
    }
  });
  startAutoScroll({ startDelay: 1, scrollDelay: 1, onStop: (r) => { stopReason = r; } });
  await waitFor(() => stopReason);
  expect(sentinelReason).toBe(stopReason);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test tests/interceptor-sentinel.test.js tests/autoscroll.test.js`
Expected: FAIL — `i.writeCompletionSentinel` / `i.downloadJSON` are not functions, and the new autoscroll test fails because `finish()` does not yet call the sentinel.

- [ ] **Step 4: Extract the `downloadJSON` helper and refactor `downloadBookmarks`**

In `interceptor-no-autostart.js`, replace the entire `downloadBookmarks(exportData)` method with a helper plus a thin wrapper:

```js
  // Trigger a browser download of `data` serialized as `filename`.
  // Returns true on success, false on a caught error. Single source of the
  // blob -> anchor -> click plumbing shared by every file the interceptor writes.
  downloadJSON(data, filename) {
    try {
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (err) {
      this.error('Failed to download', filename, err);
      return false;
    }
  }

  // Download the delta buffer as a timestamped batch file.
  downloadBookmarks(exportData) {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `x-bookmarks-graphql-${timestamp}.json`;
    const ok = this.downloadJSON(exportData, filename);
    if (ok) this.log(`Downloaded ${exportData.total_bookmarks} bookmarks to ${filename}`);
    return ok;
  }
```

- [ ] **Step 5: Add `writeCompletionSentinel`**

Immediately after `downloadBookmarks`, add:

```js
  // Write a small completion sentinel so a later combine run (or the operator)
  // can distinguish a finished run from one that was interrupted (e.g., the
  // laptop was closed). `reason` is the human-readable stop reason from the
  // auto-scroll driver — including the watchdog's "Capture stall detected."
  writeCompletionSentinel(reason) {
    const sentinel = {
      status: 'complete',
      reason,
      new_bookmarks: this.bookmarks.size,
      matched_requests: this.matchedRequestCount,
      completed_at: new Date().toISOString()
    };
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `x-bookmarks-DONE-${timestamp}.json`;
    const ok = this.downloadJSON(sentinel, filename);
    if (ok) this.log(`Wrote completion sentinel ${filename} (reason: ${reason})`);
    return ok;
  }
```

- [ ] **Step 6: Call the sentinel from `finish()`**

In `startAutoScroll`, in the `finish(reason)` function, add the sentinel call after the two `console.log` lines and before `onStop(reason)`:

```js
  function finish(reason) {
    if (stopped) return;
    stopped = true;
    console.log(`🏁 Auto-scroll stopped: ${reason}`);
    console.log(`📊 Captured ${interceptor.getBookmarkCount()} new bookmarks.`);
    interceptor.writeCompletionSentinel(reason);
    onStop(reason);
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test tests/interceptor-sentinel.test.js tests/autoscroll.test.js tests/interceptor-save.test.js`
Expected: PASS — all three files (save test included to confirm the `downloadBookmarks` refactor kept its `total_bookmarks` logging/return contract).

- [ ] **Step 8: Document sentinel-based verification in CLAUDE.md**

In `CLAUDE.md`, under "## 📂 Finding Your Downloaded Files", append:

```markdown

### Verifying a run finished (not interrupted)

Every completed auto-scroll writes one `x-bookmarks-DONE-*.json` sentinel to the
download directory. To confirm a run finished cleanly rather than being
interrupted (e.g., the laptop closed):

```bash
cat "$BOOKMARK_FILES_DIR"/x-bookmarks-DONE-*.json 2>/dev/null | tail -1
```

- `"reason": "All recent bookmarks already exist in your collection."` → clean incremental stop.
- `"reason": "Reached bottom of page."` → clean full stop.
- `"reason": "Capture stall detected."` → the interceptor was likely broken; investigate before trusting the batch.
- **No sentinel file at all** → the run did not finish; re-run before combining.
```

- [ ] **Step 9: Commit**

```bash
git add interceptor-no-autostart.js tests/interceptor-sentinel.test.js tests/autoscroll.test.js CLAUDE.md
git commit -m "feat: write x-bookmarks-DONE sentinel when auto-scroll stops

Records stop reason and counts so an interrupted run is distinguishable
from a finished one. Extracts shared downloadJSON helper for the two
file writers."
```

---

### Task 3: Sentinel-aware combine (combine-bookmarks.ts)

Make the combine step read the sentinel from Task 2 and report whether the run finished cleanly, so combining an interrupted or stalled batch is a visible, deliberate act rather than a silent one. Also generalizes the recursive file finder so it can locate sentinels and (in Task 4) cleanup targets without duplicating the walk.

**Files:**
- Modify: `combine-bookmarks.ts` — generalize `findBookmarkFiles` into `findFiles(rootDir, matches)`; add sentinel scan + reporting after the file search
- Modify (test): `tests/combine.test.ts` — extend `runCombine` to also capture stderr; add two sentinel tests

**Interfaces:**
- Consumes: `x-bookmarks-DONE-*.json` sentinel shape from Task 2 (`status`, `reason`, `new_bookmarks`, `matched_requests`, `completed_at`).
- Produces:
  - `findFiles(rootDir: string, matches: (name: string) => boolean): string[]` — recursive walk returning absolute paths whose basename satisfies `matches`. Replaces `findBookmarkFiles`.
  - `runCombine(env)` test helper now returns `{ stdout, stderr, output, code }` where `output = stdout + stderr`.

- [ ] **Step 1: Extend the test helper and write the sentinel tests**

In `tests/combine.test.ts`, replace `runCombine` so it also returns stderr:

```ts
function runCombine(env: Record<string, string>) {
  const proc = Bun.spawnSync(["bun", "combine-bookmarks.ts"], {
    cwd: import.meta.dir + "/..",
    env: { ...process.env, ...env }
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  return { stdout, stderr, output: stdout + stderr, code: proc.exitCode };
}
```

Then add these two tests at the end of the file:

```ts
test("combine reports the completion sentinel reason when present", () => {
  const inputDir = mkdtempSync(join(tmpdir(), "bm-in-"));
  const outputDir = mkdtempSync(join(tmpdir(), "bm-out-"));
  writeExport(join(outputDir, "x-bookmarks-latest.json"), [bookmark("1", "2026-01-01T00:00:00.000Z")]);
  writeExport(join(inputDir, "x-bookmarks-graphql-a.json"), [bookmark("2", "2026-07-01T00:00:00.000Z")]);
  writeFileSync(join(inputDir, "x-bookmarks-DONE-2026-07-11T00-00-00.json"), JSON.stringify({
    status: "complete",
    reason: "All recent bookmarks already exist in your collection.",
    new_bookmarks: 1,
    matched_requests: 3,
    completed_at: "2026-07-11T00:00:00.000Z"
  }));

  const { output, code } = runCombine({ BOOKMARK_FILES_DIR: inputDir, OUTPUT_DIR: outputDir });
  expect(code).toBe(0);
  expect(output).toContain("Completion sentinel found");
  expect(output).toContain("All recent bookmarks already exist");
});

test("combine warns when no completion sentinel is present", () => {
  const inputDir = mkdtempSync(join(tmpdir(), "bm-in-"));
  const outputDir = mkdtempSync(join(tmpdir(), "bm-out-"));
  writeExport(join(outputDir, "x-bookmarks-latest.json"), [bookmark("1", "2026-01-01T00:00:00.000Z")]);
  writeExport(join(inputDir, "x-bookmarks-graphql-a.json"), [bookmark("2", "2026-07-01T00:00:00.000Z")]);

  const { output, code } = runCombine({ BOOKMARK_FILES_DIR: inputDir, OUTPUT_DIR: outputDir });
  expect(code).toBe(0);
  expect(output).toContain("No completion sentinel");
});

test("combine flags a stall-reason sentinel for review", () => {
  const inputDir = mkdtempSync(join(tmpdir(), "bm-in-"));
  const outputDir = mkdtempSync(join(tmpdir(), "bm-out-"));
  writeExport(join(outputDir, "x-bookmarks-latest.json"), [bookmark("1", "2026-01-01T00:00:00.000Z")]);
  writeExport(join(inputDir, "x-bookmarks-graphql-a.json"), [bookmark("2", "2026-07-01T00:00:00.000Z")]);
  writeFileSync(join(inputDir, "x-bookmarks-DONE-2026-07-11T00-00-00.json"), JSON.stringify({
    status: "complete", reason: "Capture stall detected.", new_bookmarks: 0, matched_requests: 0,
    completed_at: "2026-07-11T00:00:00.000Z"
  }));

  const { output, code } = runCombine({ BOOKMARK_FILES_DIR: inputDir, OUTPUT_DIR: outputDir });
  expect(code).toBe(0);
  expect(output).toContain("STALL");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/combine.test.ts`
Expected: FAIL — the three new tests fail (no "Completion sentinel found" / "No completion sentinel" / "STALL" output yet). The four pre-existing combine tests still pass.

- [ ] **Step 3: Generalize the recursive finder**

In `combine-bookmarks.ts`, replace the `findBookmarkFiles` function and its call site. Replace the function definition:

```ts
// Recursively find files under rootDir whose basename satisfies `matches`,
// without shelling out (no quoting pitfalls). Skips unreadable directories,
// matching find's tolerance.
function findFiles(rootDir: string, matches: (name: string) => boolean): string[] {
  const results: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && matches(entry.name)) results.push(full);
    }
  };
  walk(rootDir);
  return results;
}

const isBookmarkFile = (name: string) =>
  /^x-bookmarks-graphql-.*\.json$/.test(name) ||
  /^x-bookmarks-combined-.*\.json$/.test(name) ||
  name === 'x-bookmarks-latest.json';

const isSentinelFile = (name: string) => /^x-bookmarks-DONE-.*\.json$/.test(name);
```

Then change the call site from `const files = findBookmarkFiles(downloadsDir);` to:

```ts
const files = findFiles(downloadsDir, isBookmarkFile);
```

- [ ] **Step 4: Scan and report the sentinel**

Immediately after the `console.log(`📁 Found ${files.length} bookmark file(s)`);` line (before the canonical-latest merge block), add:

```ts
// Report whether this batch came from a run that finished cleanly. The
// interceptor writes exactly one x-bookmarks-DONE-*.json per completed run.
const sentinels = findFiles(downloadsDir, isSentinelFile).sort();
if (sentinels.length === 0) {
  console.warn('⚠️  No completion sentinel (x-bookmarks-DONE-*.json) found.');
  console.warn('   The extraction run may have been interrupted before finishing. Combining anyway.');
} else {
  const newest = sentinels[sentinels.length - 1];
  try {
    const s = JSON.parse(await Bun.file(newest).text());
    console.log(`✅ Completion sentinel found: reason="${s.reason}", new_bookmarks=${s.new_bookmarks}, matched_requests=${s.matched_requests}`);
    if (/stall/i.test(s.reason || '')) {
      console.warn('⚠️  Run stopped on a capture STALL (interceptor may be broken). Review before trusting this batch.');
    }
  } catch (err) {
    console.warn(`⚠️  Could not read completion sentinel ${newest}:`, err);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/combine.test.ts`
Expected: PASS — all seven tests (four original + three sentinel). The generalized `findFiles` keeps the original "discovers bookmark files in nested directories" test green.

- [ ] **Step 6: Commit**

```bash
git add combine-bookmarks.ts tests/combine.test.ts
git commit -m "feat: combine reports x-bookmarks-DONE sentinel status

Warns when no sentinel is present (possible interrupted run) and flags
stall-reason stops for review. Generalizes the recursive file finder."
```

---

### Task 4: Opt-in cleanup of consumed batch files (combine-bookmarks.ts)

The `.playwright-mcp/` directory grows unbounded across runs (measured: 477MB from one run of cumulative files; delta files are smaller but still accumulate). This task adds an opt-in cleanup that deletes the raw batch files and the sentinel **after** a successful, non-shrinking merge — never touching the canonical collection.

**Files:**
- Modify: `combine-bookmarks.ts` — inside the `if (shouldUpdate)` block, after backup pruning
- Modify (test): `tests/combine.test.ts` — add cleanup on/off tests

**Interfaces:**
- Consumes: `findFiles` and env `BOOKMARK_FILES_DIR` (as `downloadsDir`), `unlinkSync` (already imported).
- Produces: env flag `CLEANUP_BATCH_FILES=1` deletes `x-bookmarks-graphql-*.json` and `x-bookmarks-DONE-*.json` under `downloadsDir` after a successful update; default (unset) leaves everything in place.

- [ ] **Step 1: Write the cleanup tests**

Add to `tests/combine.test.ts`:

```ts
test("CLEANUP_BATCH_FILES=1 deletes batch and sentinel files after a successful merge", () => {
  const inputDir = mkdtempSync(join(tmpdir(), "bm-in-"));
  const outputDir = mkdtempSync(join(tmpdir(), "bm-out-"));
  writeExport(join(outputDir, "x-bookmarks-latest.json"), [bookmark("1", "2026-01-01T00:00:00.000Z")]);
  writeExport(join(inputDir, "x-bookmarks-graphql-a.json"), [bookmark("2", "2026-07-01T00:00:00.000Z")]);
  writeFileSync(join(inputDir, "x-bookmarks-DONE-2026-07-11T00-00-00.json"),
    JSON.stringify({ status: "complete", reason: "done", new_bookmarks: 1, matched_requests: 1, completed_at: "x" }));

  const { code } = runCombine({ BOOKMARK_FILES_DIR: inputDir, OUTPUT_DIR: outputDir, CLEANUP_BATCH_FILES: "1" });
  expect(code).toBe(0);

  const left = require("fs").readdirSync(inputDir);
  expect(left.filter((f: string) => /^x-bookmarks-graphql-/.test(f)).length).toBe(0);
  expect(left.filter((f: string) => /^x-bookmarks-DONE-/.test(f)).length).toBe(0);
});

test("without CLEANUP_BATCH_FILES the raw files are left in place", () => {
  const inputDir = mkdtempSync(join(tmpdir(), "bm-in-"));
  const outputDir = mkdtempSync(join(tmpdir(), "bm-out-"));
  writeExport(join(outputDir, "x-bookmarks-latest.json"), [bookmark("1", "2026-01-01T00:00:00.000Z")]);
  writeExport(join(inputDir, "x-bookmarks-graphql-a.json"), [bookmark("2", "2026-07-01T00:00:00.000Z")]);

  const { code } = runCombine({ BOOKMARK_FILES_DIR: inputDir, OUTPUT_DIR: outputDir });
  expect(code).toBe(0);
  const left = require("fs").readdirSync(inputDir);
  expect(left.filter((f: string) => /^x-bookmarks-graphql-/.test(f)).length).toBe(1);
});

test("cleanup never deletes a canonical latest.json sharing the input directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "bm-both-"));
  // BOOKMARK_FILES_DIR and OUTPUT_DIR are the same directory here
  writeExport(join(dir, "x-bookmarks-latest.json"), [bookmark("1", "2026-01-01T00:00:00.000Z")]);
  writeExport(join(dir, "x-bookmarks-graphql-a.json"), [bookmark("2", "2026-07-01T00:00:00.000Z")]);

  const { code } = runCombine({ BOOKMARK_FILES_DIR: dir, OUTPUT_DIR: dir, CLEANUP_BATCH_FILES: "1" });
  expect(code).toBe(0);
  const left = require("fs").readdirSync(dir);
  expect(left).toContain("x-bookmarks-latest.json"); // canonical survives
  expect(left.filter((f: string) => /^x-bookmarks-graphql-/.test(f)).length).toBe(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/combine.test.ts`
Expected: FAIL — the first and third new tests fail because batch/sentinel files are not deleted (`CLEANUP_BATCH_FILES` is not yet honored). The "without cleanup" test passes already.

- [ ] **Step 3: Implement the opt-in cleanup**

In `combine-bookmarks.ts`, inside the `if (shouldUpdate) { ... }` block, after the backup-pruning `for` loop and before the block's closing brace, add:

```ts
      // Opt-in: remove the raw per-batch files and the sentinel we just merged.
      // They are pure intermediates — at this point the canonical latest.json,
      // a timestamped combined snapshot, and a backup all exist. Scoped to the
      // download directory and to graphql/DONE names, so the canonical file,
      // combined snapshots, and backups are never touched.
      if (process.env.CLEANUP_BATCH_FILES === '1') {
        const consumable = (name: string) =>
          /^x-bookmarks-graphql-.*\.json$/.test(name) || /^x-bookmarks-DONE-.*\.json$/.test(name);
        let removed = 0;
        for (const f of findFiles(downloadsDir, consumable)) {
          try {
            unlinkSync(f);
            removed++;
          } catch (err) {
            console.warn(`⚠️  Could not delete ${f}:`, err);
          }
        }
        console.log(`🧹 CLEANUP_BATCH_FILES=1: deleted ${removed} consumed batch/sentinel file(s) from ${downloadsDir}`);
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/combine.test.ts`
Expected: PASS — all ten tests.

- [ ] **Step 5: Full suite regression check**

Run: `bun test`
Expected: PASS — every test file (interceptor save/capture/load/sentinel, autoscroll, combine, export-seed-ids).

- [ ] **Step 6: Document the cleanup flag in CLAUDE.md**

In `CLAUDE.md`, in "### Step 8: Combine All Files", after the existing command block, append:

```markdown

To also delete the raw per-batch files and the completion sentinel after a
successful merge (they are redundant once `x-bookmarks-latest.json` is updated),
set `CLEANUP_BATCH_FILES=1`:

```bash
BOOKMARK_FILES_DIR="/path/to/downloads" CLEANUP_BATCH_FILES=1 bun combine-bookmarks.ts
```

This only runs after a successful, non-shrinking update, and never touches
`x-bookmarks-latest.json`, combined snapshots, or backups. Recommended for
resetting the download directory between runs so a stale sentinel from a prior
run is not re-reported.
```

- [ ] **Step 7: Commit**

```bash
git add combine-bookmarks.ts tests/combine.test.ts CLAUDE.md
git commit -m "feat: opt-in CLEANUP_BATCH_FILES to prune consumed batch/sentinel files

Deletes raw x-bookmarks-graphql-*.json and x-bookmarks-DONE-*.json under
BOOKMARK_FILES_DIR after a successful merge. Never touches the canonical
collection, combined snapshots, or backups."
```

---

## Out of Scope

- **Adaptive new-bookmark estimate.** The ~3,300 pre-run estimate was ~15% low (actual 3,807). Seeding the estimate from the prior run's delta is a nice-to-have with no correctness impact; deferred.
- **Push-based completion notification.** The sentinel makes completion detectable on disk but the operator still polls for it. A true browser→controller push is out of scope.

## Self-Review

**Spec coverage** (the three fixes I proposed + the minor doc items):
1. Cumulative→delta batch files → **Task 1** (with failure-safe buffering, a robustness addition surfaced while designing).
2. Completion signal / interrupted-run detection → **Task 2** (write) + **Task 3** (read/report).
3. Unbounded batch-file disk growth → **Task 4** (opt-in cleanup).
4. Doc updates → folded into Task 1 (file sizes), Task 2 (verification), Task 4 (cleanup flag).

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code and test step carries complete code and exact `bun test` commands with expected pass/fail.

**Type/name consistency:** `unsavedBookmarks`, `downloadBookmarks(): boolean`, `downloadJSON(data, filename)`, `writeCompletionSentinel(reason)`, `findFiles(rootDir, matches)`, `isBookmarkFile`/`isSentinelFile`, env `CLEANUP_BATCH_FILES`, and the sentinel JSON keys (`status`/`reason`/`new_bookmarks`/`matched_requests`/`completed_at`) are used identically across the tasks that produce and consume them. Task 4 depends on `findFiles` from Task 3 and on `unlinkSync` (already imported in `combine-bookmarks.ts`); Task 2's `finish()` change requires every `startAutoScroll` fake to provide `writeCompletionSentinel` (handled in Task 2 Step 2).

**Cross-task ordering:** 1 → 2 (same file, 2's `downloadJSON` extraction assumes 1's boolean-returning `downloadBookmarks`) → 3 (combine finder generalization) → 4 (reuses `findFiles`). Execute in order.

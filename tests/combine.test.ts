import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "fs";
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
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  return { stdout, stderr, output: stdout + stderr, code: proc.exitCode };
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

test("newer batch copies of a bookmark are merged over the canonical and older batches", () => {
  const inputDir = mkdtempSync(join(tmpdir(), "bm-in-"));
  const outputDir = mkdtempSync(join(tmpdir(), "bm-out-"));

  writeExport(join(outputDir, "x-bookmarks-latest.json"), [bookmark("1", "2026-01-01T00:00:00.000Z")]);
  const older = { ...bookmark("1", "2026-01-01T00:00:00.000Z"), text: "older batch" };
  const newer = {
    ...bookmark("1", "2026-01-01T00:00:00.000Z"),
    isQuoteTweet: true,
    quotedTweet: { id: "0", username: "q", text: "quoted" }
  };
  // written newest first so a readdir-order read would pick the wrong one
  writeExport(join(inputDir, "x-bookmarks-graphql-2026-09-02T00-00-00.json"), [newer]);
  writeExport(join(inputDir, "x-bookmarks-graphql-2026-09-01T00-00-00.json"), [older]);

  const { code } = runCombine({ BOOKMARK_FILES_DIR: inputDir, OUTPUT_DIR: outputDir });
  expect(code).toBe(0);

  const latest = JSON.parse(readFileSync(join(outputDir, "x-bookmarks-latest.json"), "utf8"));
  expect(latest.total_bookmarks).toBe(1);
  expect(latest.bookmarks[0].quotedTweet.text).toBe("quoted");
});

test("merge keeps the earliest capturedAt and takes newer metrics", () => {
  const inputDir = mkdtempSync(join(tmpdir(), "bm-in-"));
  const outputDir = mkdtempSync(join(tmpdir(), "bm-out-"));

  writeExport(join(outputDir, "x-bookmarks-latest.json"), [bookmark("1", "2024-03-01T00:00:00.000Z")]);
  const refreshed = {
    ...bookmark("1", "2024-03-01T00:00:00.000Z"),
    capturedAt: "2026-09-14T00:00:00.000Z",
    metrics: { replies: 5, retweets: 5, likes: 500, bookmarks: 5, views: 5000 }
  };
  writeExport(join(inputDir, "x-bookmarks-graphql-a.json"), [refreshed]);

  const { code } = runCombine({ BOOKMARK_FILES_DIR: inputDir, OUTPUT_DIR: outputDir });
  expect(code).toBe(0);

  const [b] = JSON.parse(readFileSync(join(outputDir, "x-bookmarks-latest.json"), "utf8")).bookmarks;
  expect(b.capturedAt).toBe("2024-03-01T00:00:00.000Z");
  expect(b.metrics.likes).toBe(500);
});

test("merge keeps captured quote text when the newer copy says unavailable", () => {
  const inputDir = mkdtempSync(join(tmpdir(), "bm-in-"));
  const outputDir = mkdtempSync(join(tmpdir(), "bm-out-"));

  const captured = { id: "0", username: "q", text: "quoted" };
  writeExport(join(outputDir, "x-bookmarks-latest.json"),
    [{ ...bookmark("1", "2026-01-01T00:00:00.000Z"), isQuoteTweet: true, quotedTweet: captured }]);
  writeExport(join(inputDir, "x-bookmarks-graphql-a.json"),
    [{ ...bookmark("1", "2026-01-01T00:00:00.000Z"), isQuoteTweet: true, quotedTweet: { id: "0", unavailable: true } }]);

  const { code } = runCombine({ BOOKMARK_FILES_DIR: inputDir, OUTPUT_DIR: outputDir });
  expect(code).toBe(0);

  const [b] = JSON.parse(readFileSync(join(outputDir, "x-bookmarks-latest.json"), "utf8")).bookmarks;
  expect(b.quotedTweet).toEqual(captured);
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

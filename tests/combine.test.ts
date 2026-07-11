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

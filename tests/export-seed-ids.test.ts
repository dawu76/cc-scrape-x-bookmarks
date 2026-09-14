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

test("generates a self-contained loader with inlined IDs", () => {
  const dir = mkdtempSync(join(tmpdir(), "seed-"));
  const input = join(dir, "latest.json");
  const output = join(dir, "seed-ids.json");
  const loader = join(dir, "seed-loader.js");
  writeFileSync(input, JSON.stringify({
    bookmarks: [
      { id: "a1", capturedAt: "2026-01-01T00:00:00.000Z" },
      { id: "b2", capturedAt: "2026-02-01T00:00:00.000Z" }
    ]
  }));
  const proc = Bun.spawnSync(["bun", "export-seed-ids.ts", input, output, loader],
    { cwd: import.meta.dir + "/.." });
  expect(proc.exitCode).toBe(0);
  const code = readFileSync(loader, "utf8");
  expect(code.startsWith("async (page) =>")).toBe(true);
  expect(code).toContain('"b2","a1"');   // inlined, capturedAt-descending
  expect(code).toContain("of 2 seed IDs");
  // must be a valid JS expression: evaluating it yields a function
  const fn = new Function("return (" + code + ")")();
  expect(typeof fn).toBe("function");
});

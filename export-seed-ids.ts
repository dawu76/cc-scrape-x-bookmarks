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

// Also generate the self-contained loader that browser_run_code_unsafe
// executes via its `filename` parameter. The tool's sandbox has no require()
// or dynamic import(), so the IDs are inlined as a literal (verified 2026-07-11).
const loaderPath = process.argv[4] || './data/seed-loader.js';
const loader = `async (page) => {
  const ids = ${JSON.stringify(ids)};
  await page.evaluate(() => { window.bookmarkInterceptor.existingBookmarkIds.clear(); });
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    await page.evaluate((c) => {
      window.bookmarkInterceptor.loadExistingBookmarks({ bookmarks: c.map(id => ({ id })) });
    }, chunk);
  }
  const size = await page.evaluate(() => window.bookmarkInterceptor.existingBookmarkIds.size);
  return 'Loaded ' + size + ' of ${ids.length} seed IDs';
}`;
await Bun.write(loaderPath, loader);
console.log(`✅ Wrote seed loader to ${loaderPath}`);

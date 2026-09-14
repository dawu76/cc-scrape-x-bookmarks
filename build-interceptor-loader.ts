#!/usr/bin/env bun
// Generates the loader that CLAUDE.md Step 3 runs with browser_run_code_unsafe.
// The loader registers the interceptor as a Playwright init script so its hooks
// exist before X requests the first page of bookmarks, then loads that page.
// Injecting into an already-loaded page misses the first page (the newest ~20
// bookmarks). The tool's sandbox cannot read files, so the interceptor source
// is inlined as a string literal.

const interceptorPath = process.argv[2] || './interceptor-no-autostart.js';
const loaderPath = process.argv[3] || './data/interceptor-loader.js';
const bookmarksUrl = 'https://x.com/i/bookmarks';

const source = Bun.file(interceptorPath);
if (!(await source.exists())) {
  console.error(`❌ Interceptor not found: ${interceptorPath}`);
  process.exit(1);
}

// Init scripts run in every frame and accumulate per page. The guards keep the
// hooks to the top-level document and stop repeated loader runs in one browser
// session from stacking a second set of hooks.
const initScript = `(function () {
  if (window.top !== window) return;
  if (window.bookmarkInterceptor) return;
${await source.text()}
  window.bookmarkInterceptor.install();
})();
`;

const loader = `async (page) => {
  await page.addInitScript({ content: ${JSON.stringify(initScript)} });
  await page.goto(${JSON.stringify(bookmarksUrl)});
  try {
    await page.waitForFunction(
      () => window.bookmarkInterceptor && window.bookmarkInterceptor.matchedRequestCount > 0,
      null,
      { timeout: 30000 }
    );
  } catch (e) {
    // Reported below as "first page matched: false".
  }
  return await page.evaluate(() => {
    const bi = window.bookmarkInterceptor;
    if (!bi) return 'isActive: false (interceptor missing)';
    return 'isActive: ' + bi.isActive +
      ', first page matched: ' + (bi.matchedRequestCount > 0) +
      ', captured: ' + bi.getBookmarkCount();
  });
}`;

await Bun.write(loaderPath, loader);
console.log(`✅ Wrote interceptor loader to ${loaderPath}`);

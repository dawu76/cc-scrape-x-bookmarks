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

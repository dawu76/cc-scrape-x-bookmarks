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

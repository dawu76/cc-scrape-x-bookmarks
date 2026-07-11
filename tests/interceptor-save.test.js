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

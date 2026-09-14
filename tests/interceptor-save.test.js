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

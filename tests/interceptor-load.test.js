import { test, expect } from "bun:test";

test("interceptor file parses and exports the class", () => {
  const { BookmarkGraphQLInterceptor } = require("../interceptor-no-autostart.js");
  const i = new BookmarkGraphQLInterceptor();
  expect(i.getBookmarkCount()).toBe(0);
  expect(i.shouldStopAutoScroll()).toBe(false);
});

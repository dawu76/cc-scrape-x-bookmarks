import { test, expect } from "bun:test";
const { BookmarkGraphQLInterceptor } = require("../interceptor-no-autostart.js");
const { makeBookmarkResponse, makeTweetResult } = require("./fixtures.js");

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

// Returns a one-bookmark response plus its tweet object, for tests that edit the tweet.
function responseWithTweet(id) {
  const res = makeBookmarkResponse([id]);
  const entry = res.data.bookmark_timeline_v2.timeline.instructions[0].entries[0];
  return { res, tweet: entry.content.itemContent.tweet_results.result };
}

test("quote tweets carry the quoted tweet's id, author, text, and date", () => {
  const { res, tweet } = responseWithTweet("31");
  tweet.legacy.is_quote_status = true;
  tweet.legacy.quoted_status_id_str = "30";
  tweet.quoted_status_result = { result: makeTweetResult("30", "quoted_author") };

  const [b] = new BookmarkGraphQLInterceptor().extractBookmarksFromResponse(res);
  expect(b.quotedTweet).toEqual({
    id: "30",
    url: "https://x.com/quoted_author/status/30",
    username: "quoted_author",
    text: "tweet 30",
    timestamp: "2023-09-28T11:07:25.000Z"
  });
});

test("quoted tweets wrapped in TweetWithVisibilityResults are unwrapped", () => {
  const { res, tweet } = responseWithTweet("41");
  tweet.legacy.is_quote_status = true;
  tweet.quoted_status_result = {
    result: { __typename: "TweetWithVisibilityResults", tweet: makeTweetResult("40") }
  };

  const [b] = new BookmarkGraphQLInterceptor().extractBookmarksFromResponse(res);
  expect(b.quotedTweet.id).toBe("40");
  expect(b.quotedTweet.text).toBe("tweet 40");
});

test("a quoted tweet X did not return keeps its id and is marked unavailable", () => {
  const { res, tweet } = responseWithTweet("51");
  tweet.legacy.is_quote_status = true;
  tweet.legacy.quoted_status_id_str = "50";
  tweet.quoted_status_result = { result: { __typename: "TweetTombstone" } };

  const [b] = new BookmarkGraphQLInterceptor().extractBookmarksFromResponse(res);
  expect(b.quotedTweet).toEqual({ id: "50", unavailable: true });
});

test("non-quote tweets have quotedTweet null", () => {
  const [b] = new BookmarkGraphQLInterceptor().extractBookmarksFromResponse(makeBookmarkResponse(["61"]));
  expect(b.quotedTweet).toBeNull();
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

# Interceptor Internals: XHR/Fetch Hooking

How `interceptor-no-autostart.js` captures bookmark data, and why it's built
the way it is. This is implementation detail for anyone modifying the
interceptor — the operational steps for running it live in
[CLAUDE.md](../CLAUDE.md).

## Why hook the network layer at all

X's bookmarks page loads tweets via GraphQL as the user scrolls. The
rendered DOM only shows what React chose to display — not the full
engagement metrics, media entities, or verification status the extractor
needs. Reading the DOM would also be fragile against markup changes.
Intercepting the raw GraphQL response bodies is the only reliable way to get
complete, structured data.

## Two hooks, one purpose

### XHR hook (`install()`, lines 33-70)

```js
this.originalXHROpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url, ...args) {
  self.originalXHROpen.apply(this, [method, url, ...args]);
  if (self.isBookmarkRequest(url)) {
    this.addEventListener('load', function() {
      self.handleBookmarkResponse(this, method, url);
    });
  }
};
```

This monkey-patches `XMLHttpRequest.prototype.open` itself, not any single
instance. Every XHR the page creates — including ones deep inside X's React
bundle that the interceptor has no other handle on — goes through
`new XMLHttpRequest()` then `.open()`. Patching the shared prototype method
means every future XHR is visible to the interceptor. When the URL matches
the bookmarks GraphQL endpoint, a `load` listener reads `xhr.responseText`
once the response arrives.

### Fetch hook (`installFetchHook()`, lines 94-124)

```js
this.originalFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const resultPromise = self.originalFetch.apply(this, arguments);
  if (self.isBookmarkRequest(url)) {
    resultPromise.then((response) => {
      response.clone().text().then((text) => { /* ... */ });
    });
  }
  return resultPromise;
};
```

Same idea, different transport. `fetch` is a global function, not a
prototype method, so it's replaced directly on `globalThis`. The critical
detail is `response.clone()`: a `fetch` `Response` body can only be read
once. Reading the original directly would drain it before the page's own
caller sees it. Cloning gives the interceptor an independent copy while the
original response passes through untouched.

**Why both, simultaneously**: X has changed which transport it uses for
GraphQL calls before, and the interceptor doesn't control that choice.
Installing both hooks makes capture resilient to an XHR→fetch migration
instead of betting on one transport.

## The endpoint filter

`isBookmarkRequest()` (line 129) uses a narrow regex:
`/\/graphql\/.+\/Bookmarks/`. X's GraphQL surface has dozens of endpoints
(timeline, likes, follows, search, etc.) all hitting
`/graphql/<hash>/<OperationName>`. Without this filter the interceptor would
try to parse every GraphQL response as a bookmark timeline and fail loudly
on all the ones that aren't.

## Quoted tweets

`extractQuotedTweet()` reads `tweet.quoted_status_result.result`, which X
fills with the same object shape as a top-level tweet, so the existing
`extractTweetText()` and `parseTwitterDateTime()` helpers work on it
unchanged. Three cases:

- **Plain `Tweet`:** returns `{ id, url, username, displayName, text,
  timestamp, media }`. `media` comes from the same `extractTweetMedia()` used
  for top-level bookmarks, so `download-media.ts` treats both alike.
- **`TweetWithVisibilityResults`:** X wraps tweets that carry visibility
  notices one level deeper, so the real tweet is at `.tweet`. The same wrapper
  shows up for top-level bookmarks in `extractBookmarkFromTimelineEntry()`.
- **No `legacy` data** (tombstone for a deleted, protected, or withheld
  tweet): returns `{ id, unavailable: true }` using
  `tweet.legacy.quoted_status_id_str`, or `null` if X sent no ID.

Tweets that quote nothing get `quotedTweet: null`. That keeps them distinct
from records captured before the field existed, which have no `quotedTweet`
key at all.

The tests in `tests/interceptor-capture.test.js` build these shapes from
`tests/fixtures.js`. They follow X's usual response, not a saved one, so
check a live batch file before trusting a long run.

## Execution-context check

`checkExecutionContext()` (line 133) runs a second after `install()` and
warns if neither `window.webpackChunk_twitter_responsive_web` nor
`window.__MAIN_BUNDLE__` exists. This guards against a classic
browser-extension failure mode: if the script ran in an isolated "content
script" world (as extensions do by default), patching
`XMLHttpRequest.prototype` there would only affect XHRs made from that
isolated world — not the real page's XHRs made by X's own bundle running in
the main world. The prototype patch would silently do nothing.
Playwright's `browser_evaluate` runs in the page's main world by default,
which is why this project works — the check exists so a broken injection
method announces itself in the console instead of failing silently with
"0 bookmarks captured."

## `install()` is not automatic

Evaluating the script only runs the class constructor. It builds
`window.bookmarkInterceptor` but does not attach either hook. `install()`
must run before `startAutoScroll()`, or scrolling proceeds with zero captures
and eventually trips the stall watchdog (10 scrolls with no intercepted
response). The Step 3 loader generated by `build-interceptor-loader.ts` calls
`install()` inside its init script and reports `isActive`.

## Install timing and the first page

X requests the first page of bookmarks (`count: 20`, no cursor) as soon as
the bookmarks timeline mounts. Hooks installed after that never see it, so
the newest ~20 bookmarks are skipped without any error. Switching to another
History tab and back does not help: X renders the cached timeline and only
sends a cursor poll for newer items, which returns cursor entries and no
tweets. (The poll still counts as a matched request, which makes a broken
capture look healthy.)

The loader avoids this with Playwright's `page.addInitScript`, which runs in
every new document before any page script. Two consequences:

- Every page load builds a fresh interceptor, so seed IDs loaded in Step 4
  are lost if the page reloads or navigates afterwards.
- Init scripts run in every frame, including X's iframes, and accumulate per
  page. The injected code starts with `if (window.top !== window) return;`
  (hooks only the top-level document) and
  `if (window.bookmarkInterceptor) return;` (repeated loader runs do not stack
  a second set of hooks).

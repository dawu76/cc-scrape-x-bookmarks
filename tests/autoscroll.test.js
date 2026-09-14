import { test, expect, afterEach } from "bun:test";
const { startAutoScroll } = require("../interceptor-no-autostart.js");

function fakeEnvironment({ interceptor }) {
  let height = 0;
  globalThis.window = { bookmarkInterceptor: interceptor, scrollTo: () => {} };
  globalThis.document = {
    // strictly increasing height => "reached bottom" never fires
    body: { get scrollHeight() { height += 100; return height; } }
  };
}

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

function waitFor(getter, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = () => {
      const v = getter();
      if (v) return resolve(v);
      if (Date.now() - t0 > timeoutMs) return reject(new Error("timeout"));
      setTimeout(poll, 5);
    };
    poll();
  });
}

test("stops with stall reason when no bookmark responses are intercepted", async () => {
  let stopReason = null;
  fakeEnvironment({
    interceptor: {
      shouldStopAutoScroll: () => false,
      getBookmarkCount: () => 0,
      matchedRequestCount: 0,
      writeCompletionSentinel: () => true
    }
  });
  startAutoScroll({ startDelay: 1, scrollDelay: 1, stallLimit: 3, onStop: (r) => { stopReason = r; } });
  await waitFor(() => stopReason);
  expect(stopReason).toBe("Capture stall detected.");
});

test("stops when interceptor signals all-existing auto-stop", async () => {
  let stopReason = null;
  let calls = 0;
  fakeEnvironment({
    interceptor: {
      shouldStopAutoScroll: () => ++calls > 2, // stops on the 3rd check
      getBookmarkCount: () => 7,
      matchedRequestCount: 0,
      writeCompletionSentinel: () => true
    }
  });
  startAutoScroll({ startDelay: 1, scrollDelay: 1, stallLimit: 100, onStop: (r) => { stopReason = r; } });
  await waitFor(() => stopReason);
  expect(stopReason).toBe("All recent bookmarks already exist in your collection.");
});

test("writes a completion sentinel when auto-scroll stops", async () => {
  let stopReason = null;
  let sentinelReason = null;
  fakeEnvironment({
    interceptor: {
      shouldStopAutoScroll: () => true,
      getBookmarkCount: () => 3,
      matchedRequestCount: 0,
      writeCompletionSentinel: (r) => { sentinelReason = r; return true; }
    }
  });
  startAutoScroll({ startDelay: 1, scrollDelay: 1, onStop: (r) => { stopReason = r; } });
  await waitFor(() => stopReason);
  expect(sentinelReason).toBe(stopReason);
});

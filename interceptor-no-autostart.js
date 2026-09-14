// GraphQL Bookmark Interceptor for X (Twitter)
// Based on Twitter Web Exporter approach
// This script intercepts GraphQL API calls to capture all bookmark data

class BookmarkGraphQLInterceptor {
  constructor() {
    this.bookmarks = new Map(); // Use Map to deduplicate by ID
    this.existingBookmarkIds = new Set(); // Track existing bookmark IDs
    this.isActive = false;
    this.originalXHROpen = null;
    this.originalFetch = null;
    this.matchedRequestCount = 0; // successfully parsed bookmark responses (any transport)
    this.logPrefix = '[X-Bookmarks-GraphQL]';
    this.shouldStopScrolling = false; // Flag to stop auto-scroll when we hit existing bookmarks
    this.consecutiveExistingCount = 0; // consecutive batches where every bookmark already existed
    this.stopThreshold = 5; // stop after this many consecutive all-existing batches
    this.unsavedBookmarks = []; // delta buffer: new bookmarks not yet written to disk
  }

  log(message, ...args) {
    console.log(this.logPrefix, message, ...args);
  }

  warn(message, ...args) {
    console.warn(this.logPrefix, message, ...args);
  }

  error(message, ...args) {
    console.error(this.logPrefix, message, ...args);
  }

  // Install XMLHttpRequest hooks to intercept API calls
  install() {
    if (this.isActive) {
      this.warn('GraphQL interceptor is already active');
      return;
    }

    if (typeof XMLHttpRequest !== 'undefined') {
      // Store original XMLHttpRequest.open method
      this.originalXHROpen = XMLHttpRequest.prototype.open;
      const self = this;

      // Override XMLHttpRequest.prototype.open
      XMLHttpRequest.prototype.open = function(method, url, ...args) {
        // Apply the original open method
        self.originalXHROpen.apply(this, [method, url, ...args]);

        // Check if this is a bookmark GraphQL request
        if (self.isBookmarkRequest(url)) {
          self.log('Detected bookmark GraphQL request:', url);

          // Add load event listener to capture response
          this.addEventListener('load', function() {
            self.handleBookmarkResponse(this, method, url);
          });
        }
      };
    } else {
      this.warn('XMLHttpRequest not available; skipping XHR hook');
    }

    this.installFetchHook();

    this.isActive = true;
    this.log('GraphQL interceptor installed');
    
    // Check execution context
    this.checkExecutionContext();
  }

  // Remove XMLHttpRequest hooks
  uninstall() {
    if (!this.isActive) {
      this.warn('GraphQL interceptor is not active');
      return;
    }

    if (this.originalXHROpen) {
      XMLHttpRequest.prototype.open = this.originalXHROpen;
      this.originalXHROpen = null;
    }

    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = null;
    }

    this.isActive = false;
    this.log('GraphQL interceptor uninstalled');
  }

  // Install fetch() hook so capture survives an XHR->fetch migration by X
  installFetchHook() {
    if (typeof globalThis.fetch !== 'function') {
      this.warn('fetch not available; skipping fetch hook');
      return;
    }
    this.originalFetch = globalThis.fetch;
    const self = this;
    globalThis.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const resultPromise = self.originalFetch.apply(this, arguments);
      if (self.isBookmarkRequest(url)) {
        self.log('Detected bookmark GraphQL request (fetch):', url);
        resultPromise
          .then((response) => {
            if (response.status !== 200) {
              self.warn(`Non-200 fetch response for ${url}:`, response.status);
              return;
            }
            response
              .clone()
              .text()
              .then((text) => {
                if (text) self.processResponseText(text, url);
              })
              .catch((err) => self.error('Failed to read fetch response body:', err));
          })
          .catch(() => { /* network errors belong to the page, not the hook */ });
      }
      return resultPromise;
    };
  }

  // Check if the URL is a bookmark GraphQL request
  isBookmarkRequest(url) {
    // Match bookmark GraphQL endpoints
    return /\/graphql\/.+\/Bookmarks/.test(url);
  }

  // Check execution context (similar to Twitter Web Exporter)
  checkExecutionContext() {
    setTimeout(() => {
      // Check for Twitter-specific global objects to ensure we're in the right context
      if (!window.webpackChunk_twitter_responsive_web && !window.__MAIN_BUNDLE__) {
        this.error(
          'Warning: Wrong execution context detected.\n' +
          'This script needs to be injected into "page" context rather than "content" context.\n' +
          'The XMLHttpRequest hook may not work properly.'
        );
      } else {
        this.log('Execution context check passed');
      }
    }, 1000);
  }

  // Handle bookmark GraphQL response (XHR transport)
  handleBookmarkResponse(xhr, method, url) {
    if (xhr.status !== 200) {
      this.warn(`Non-200 response for ${url}:`, xhr.status);
      return;
    }
    if (!xhr.responseText) {
      this.warn('Empty response for', url);
      return;
    }
    this.processResponseText(xhr.responseText, url);
  }

  // Transport-agnostic: parse one bookmark GraphQL response body
  processResponseText(responseText, url) {
    try {
      this.matchedRequestCount++;
      const json = JSON.parse(responseText);
      const newBookmarks = this.extractBookmarksFromResponse(json);

      if (newBookmarks.length > 0) {
        let newCount = 0;
        let existingCount = 0;

        // Check each bookmark against existing IDs
        newBookmarks.forEach(bookmark => {
          if (this.existingBookmarkIds.has(bookmark.id)) {
            existingCount++;
            this.log(`⏭️  Skipping existing bookmark: ${bookmark.id}`);
          } else {
            this.bookmarks.set(bookmark.id, bookmark);
            this.unsavedBookmarks.push(bookmark);
            newCount++;
          }
        });

        // Update consecutive existing count
        if (existingCount === newBookmarks.length && newBookmarks.length > 0) {
          // All bookmarks in this batch already exist
          this.consecutiveExistingCount++;
          this.log(`⚠️  All ${newBookmarks.length} bookmarks in this batch already exist (consecutive: ${this.consecutiveExistingCount}/${this.stopThreshold})`);

          if (this.consecutiveExistingCount >= this.stopThreshold) {
            this.shouldStopScrolling = true;
            this.log(`🛑 Stopping auto-scroll: encountered ${this.stopThreshold} consecutive batches of existing bookmarks`);
          }
        } else if (newCount > 0) {
          // Reset counter if we found new bookmarks
          this.consecutiveExistingCount = 0;
        }

        if (newCount > 0) {
          this.log(`✅ Captured ${newCount} new bookmarks (${existingCount} already existed, total: ${this.bookmarks.size})`);

          // Trigger storage update only if we have new bookmarks
          this.saveBookmarks();
        }
      }

    } catch (err) {
      this.error('Failed to parse bookmark response:', err);
      this.error('URL:', url);
      this.error('Response:', responseText?.substring(0, 500) + '...');
    }
  }

  // Extract bookmark data from GraphQL response (based on Twitter Web Exporter logic)
  extractBookmarksFromResponse(json) {
    const newBookmarks = [];

    try {
      // Navigate to bookmark timeline instructions
      const instructions = json?.data?.bookmark_timeline_v2?.timeline?.instructions;
      
      if (!instructions || !Array.isArray(instructions)) {
        this.warn('No timeline instructions found in response');
        return newBookmarks;
      }

      // Find TimelineAddEntries instruction
      const timelineAddEntriesInstruction = instructions.find(
        instruction => instruction.type === 'TimelineAddEntries'
      );

      if (!timelineAddEntriesInstruction) {
        this.warn('No TimelineAddEntries instruction found');
        return newBookmarks;
      }

      const entries = timelineAddEntriesInstruction.entries || [];
      
      for (const entry of entries) {
        // Extract tweet from timeline entry
        if (this.isTimelineEntryTweet(entry)) {
          const bookmark = this.extractBookmarkFromTimelineEntry(entry);
          if (bookmark) {
            newBookmarks.push(bookmark);
          }
        }
      }

    } catch (err) {
      this.error('Error extracting bookmarks:', err);
    }

    return newBookmarks;
  }

  // Check if timeline entry is a tweet
  isTimelineEntryTweet(entry) {
    return (
      entry?.content?.entryType === 'TimelineTimelineItem' &&
      entry?.entryId?.startsWith('tweet-') &&
      entry?.content?.itemContent?.__typename === 'TimelineTweet'
    );
  }

  // Extract bookmark data from timeline entry
  extractBookmarkFromTimelineEntry(entry) {
    try {
      const tweetContent = entry.content.itemContent;
      const tweetResult = tweetContent?.tweet_results?.result;

      if (!tweetResult) {
        this.warn('No tweet result found in timeline entry');
        return null;
      }

      // Handle different tweet result types
      let tweet = null;
      if (tweetResult.__typename === 'Tweet') {
        tweet = tweetResult;
      } else if (tweetResult.__typename === 'TweetWithVisibilityResults') {
        tweet = tweetResult.tweet;
      } else {
        this.warn('Unsupported tweet type:', tweetResult.__typename);
        return null;
      }

      if (!tweet || !tweet.legacy) {
        this.warn('Empty tweet or missing legacy data');
        return null;
      }

      // Extract bookmark data
      const user = tweet.core?.user_results?.result;
      if (!user) {
        this.warn('No user data found in tweet');
        return null;
      }

      const bookmark = {
        id: tweet.rest_id,
        url: `https://x.com/${user.core.screen_name}/status/${tweet.legacy.id_str}`,
        username: user.core.screen_name,
        displayName: user.core.name,
        isVerified: user.verification?.verified || false,
        text: this.extractTweetText(tweet),
        timestamp: this.parseTwitterDateTime(tweet.legacy.created_at),
        metrics: {
          replies: tweet.legacy.reply_count || 0,
          retweets: tweet.legacy.retweet_count || 0,
          likes: tweet.legacy.favorite_count || 0,
          bookmarks: tweet.legacy.bookmark_count || 0,
          views: this.parseViewCount(tweet.views?.count) || 0
        },
        media: this.extractTweetMedia(tweet),
        isRetweet: !!tweet.legacy.retweeted_status_result,
        isQuoteTweet: tweet.legacy.is_quote_status || false,
        capturedAt: new Date().toISOString(),
        source: 'graphql-api'
      };

      return bookmark;

    } catch (err) {
      this.error('Error extracting bookmark from timeline entry:', err);
      return null;
    }
  }

  // Extract tweet text (handle note tweets for long content)
  extractTweetText(tweet) {
    return tweet.note_tweet?.note_tweet_results?.result?.text || tweet.legacy.full_text;
  }

  // Parse Twitter datetime format
  parseTwitterDateTime(dateStr) {
    try {
      // Convert "Thu Sep 28 11:07:25 +0000 2023" to ISO format
      const date = new Date(dateStr);
      return date.toISOString();
    } catch (err) {
      this.warn('Failed to parse date:', dateStr, err);
      return new Date().toISOString();
    }
  }

  // Parse view count (can be string)
  parseViewCount(viewCount) {
    if (typeof viewCount === 'string') {
      return parseInt(viewCount, 10) || 0;
    }
    return viewCount || 0;
  }

  // Extract media from tweet
  extractTweetMedia(tweet) {
    const media = [];
    
    try {
      // Use extended_entities first, then fallback to entities
      const mediaEntities = tweet.legacy.extended_entities?.media || tweet.legacy.entities?.media || [];
      
      for (const mediaItem of mediaEntities) {
        media.push({
          id: mediaItem.id_str,
          type: mediaItem.type,
          url: mediaItem.media_url_https,
          expanded_url: mediaItem.expanded_url,
          alt_text: mediaItem.ext_alt_text || ''
        });
      }
    } catch (err) {
      this.warn('Error extracting media:', err);
    }

    return media;
  }

  // Save bookmarks by downloading a JSON snapshot of only the bookmarks
  // captured since the last successful save (a delta). Files on disk are the
  // durable store; the combine script deduplicates by ID and recovers from
  // partial runs. The buffer is cleared only when the download succeeds, so a
  // failed save is retried in the next batch instead of being lost.
  saveBookmarks() {
    if (this.unsavedBookmarks.length === 0) return;
    const exportData = {
      exported_at: new Date().toISOString(),
      total_bookmarks: this.unsavedBookmarks.length,
      source: 'graphql-interceptor',
      bookmarks: this.unsavedBookmarks
    };
    if (this.downloadBookmarks(exportData)) {
      this.unsavedBookmarks = [];
    }
  }

  // Trigger a browser download of `data` serialized as `filename`.
  // Returns true on success, false on a caught error. Single source of the
  // blob -> anchor -> click plumbing shared by every file the interceptor writes.
  downloadJSON(data, filename) {
    try {
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (err) {
      this.error('Failed to download', filename, err);
      return false;
    }
  }

  // Download the delta buffer as a timestamped batch file.
  downloadBookmarks(exportData) {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `x-bookmarks-graphql-${timestamp}.json`;
    const ok = this.downloadJSON(exportData, filename);
    if (ok) this.log(`Downloaded ${exportData.total_bookmarks} bookmarks to ${filename}`);
    return ok;
  }

  // Write a small completion sentinel so a later combine run (or the operator)
  // can distinguish a finished run from one that was interrupted (e.g., the
  // laptop was closed). `reason` is the human-readable stop reason from the
  // auto-scroll driver — including the watchdog's "Capture stall detected."
  writeCompletionSentinel(reason) {
    const sentinel = {
      status: 'complete',
      reason,
      new_bookmarks: this.bookmarks.size,
      matched_requests: this.matchedRequestCount,
      completed_at: new Date().toISOString()
    };
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `x-bookmarks-DONE-${timestamp}.json`;
    const ok = this.downloadJSON(sentinel, filename);
    if (ok) this.log(`Wrote completion sentinel ${filename} (reason: ${reason})`);
    return ok;
  }

  // Get current bookmark count
  getBookmarkCount() {
    return this.bookmarks.size;
  }

  // Get all bookmarks as array
  getAllBookmarks() {
    return Array.from(this.bookmarks.values());
  }

  // Clear all captured bookmarks
  clearBookmarks() {
    this.bookmarks.clear();
    this.log('Cleared all bookmarks');
  }

  // Load existing bookmarks from a JSON file/object to enable incremental updates
  loadExistingBookmarks(bookmarksData) {
    try {
      if (!bookmarksData) {
        this.warn('No existing bookmarks data provided');
        return;
      }

      // Handle both parsed JSON object and string
      const data = typeof bookmarksData === 'string' ? JSON.parse(bookmarksData) : bookmarksData;

      if (data.bookmarks && Array.isArray(data.bookmarks)) {
        // Extract IDs and add to the existing bookmarks set
        data.bookmarks.forEach(bookmark => {
          if (bookmark.id) {
            this.existingBookmarkIds.add(bookmark.id);
          }
        });

        this.log(`Loaded ${this.existingBookmarkIds.size} existing bookmark IDs`);
        this.log('Auto-scroll will stop when encountering bookmarks that already exist');
      } else {
        this.warn('Invalid bookmarks data format. Expected {bookmarks: [...]}');
      }
    } catch (err) {
      this.error('Failed to load existing bookmarks:', err);
    }
  }

  // Check if auto-scroll should stop
  shouldStopAutoScroll() {
    return this.shouldStopScrolling;
  }

  // Reset the stop flag (useful for manual re-runs)
  resetStopFlag() {
    this.shouldStopScrolling = false;
    this.consecutiveExistingCount = 0;
    this.log('Reset stop flag - auto-scroll can continue');
  }
}

// Auto-scroll driver. Single source of truth — CLAUDE.md Step 5 calls this;
// do not paste a copy of this loop into documentation.
function startAutoScroll(options = {}) {
  const maxScrolls = options.maxScrolls || 10000;
  const scrollDelay = options.scrollDelay || 4000;
  const startDelay = options.startDelay || 3000;
  // Watchdog: if this many scrolls pass without a single intercepted bookmark
  // response, the interceptor is likely broken (e.g., X changed its API).
  const stallLimit = options.stallLimit || 10;
  const onStop = options.onStop || function () {};

  const interceptor = window.bookmarkInterceptor;
  let scrollCount = 0;
  let lastMatchedCount = interceptor.matchedRequestCount;
  let stalledScrolls = 0;
  let stopped = false;

  function finish(reason) {
    if (stopped) return;
    stopped = true;
    console.log(`🏁 Auto-scroll stopped: ${reason}`);
    console.log(`📊 Captured ${interceptor.getBookmarkCount()} new bookmarks.`);
    interceptor.writeCompletionSentinel(reason);
    onStop(reason);
  }

  function performScroll() {
    if (interceptor.shouldStopAutoScroll()) {
      return finish('All recent bookmarks already exist in your collection.');
    }
    if (scrollCount >= maxScrolls) {
      return finish('Maximum scroll limit reached.');
    }

    if (interceptor.matchedRequestCount === lastMatchedCount) {
      stalledScrolls++;
      if (stalledScrolls >= stallLimit) {
        console.error(
          `🛑 No bookmark API responses intercepted in the last ${stallLimit} scrolls. ` +
          `The interceptor may be broken (X may have changed its API). Stopping.`
        );
        return finish('Capture stall detected.');
      }
    } else {
      stalledScrolls = 0;
      lastMatchedCount = interceptor.matchedRequestCount;
    }

    const currentHeight = document.body.scrollHeight;
    window.scrollTo(0, currentHeight);
    scrollCount++;
    console.log(`📜 Auto-scroll ${scrollCount}/${maxScrolls} - Scrolled to: ${currentHeight}`);

    setTimeout(() => {
      if (interceptor.shouldStopAutoScroll()) {
        return finish('All recent bookmarks already exist in your collection.');
      }
      if (document.body.scrollHeight === currentHeight) {
        return finish('Reached bottom of page.');
      }
      performScroll();
    }, scrollDelay);
  }

  console.log(`🚀 Starting auto-scroll in ${startDelay / 1000} seconds...`);
  setTimeout(performScroll, startDelay);
}

// Create global instance (browser injection context only)
if (typeof window !== 'undefined') {
  window.bookmarkInterceptor = new BookmarkGraphQLInterceptor();
  window.startAutoScroll = startAutoScroll;
  console.log('✅ Interceptor ready! Use window.bookmarkInterceptor');
  console.log('🚀 To start auto-scroll: call startAutoScroll()');
}

// Export for Node/Bun test usage (no-op in the browser)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BookmarkGraphQLInterceptor, startAutoScroll };
}


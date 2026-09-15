// Builds one tweet_results.result object in X's GraphQL shape.
function makeTweetResult(id, screenName = "trader") {
  return {
    __typename: "Tweet",
    rest_id: String(id),
    views: { count: "100" },
    core: {
      user_results: {
        result: {
          core: { screen_name: screenName, name: "Trader" },
          verification: { verified: true }
        }
      }
    },
    legacy: {
      id_str: String(id),
      full_text: `tweet ${id}`,
      created_at: "Thu Sep 28 11:07:25 +0000 2023",
      reply_count: 1,
      retweet_count: 2,
      favorite_count: 3,
      bookmark_count: 4,
      is_quote_status: false
    }
  };
}

// Builds a minimal-but-realistic Bookmarks GraphQL response for the given tweet IDs.
function makeBookmarkResponse(ids) {
  return {
    data: {
      bookmark_timeline_v2: {
        timeline: {
          instructions: [
            {
              type: "TimelineAddEntries",
              entries: ids.map((id) => ({
                entryId: `tweet-${id}`,
                content: {
                  entryType: "TimelineTimelineItem",
                  itemContent: {
                    __typename: "TimelineTweet",
                    tweet_results: { result: makeTweetResult(id) }
                  }
                }
              }))
            }
          ]
        }
      }
    }
  };
}

module.exports = { makeBookmarkResponse, makeTweetResult };

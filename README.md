# X Bookmark Extractor with Claude Code

**An example repository demonstrating how to use Claude Code to download ALL of your X (Twitter) bookmarks with real engagement metrics.**

This project showcases the power of combining Claude Code with the Playwright MCP server to automate web interactions and data extraction. With just a few simple steps, you can extract your complete bookmark collection including real metrics that aren't available through X's standard interface.

## 🤖 Automated Setup
Go To:
`https://uithub.com/firstloophq/cc-scrape-x-bookmarks`

Copy the the entire repo. Give it Claude Code and let it get to work!


## 🚀 Manual Setup

### Step 1: Clone and Setup

```bash
git clone https://github.com/firstloophq/cc-scrape-x-bookmarks.git
cd cc-scrape-x-bookmarks
```

### Step 2: Add the Playwright MCP Server

```bash
claude mcp add playwright -s local -- npx @playwright/mcp@0.0.80
```

Pinned to 0.0.80 because 0.0.81 crashes on the first bookmark file download.
See CLAUDE.md Troubleshooting → "Playwright MCP server crashes on the first
batch download" before switching to `@latest`.

### Step 3: Open Claude Code and Point to Instructions

Load Claude Code and point it to the `CLAUDE.md` file in this repository, which contains detailed step-by-step instructions for the extraction process.

## 🎯 How It Works

1. **Login**: Navigate to X bookmarks and login with your account
2. **Inject**: Install the GraphQL interceptor before the bookmarks page loads, so the newest page is captured too
3. **Load Existing** (optional): Load the IDs from your previous collection to enable incremental mode
4. **Extract**: Auto-scroll through your bookmarks while capturing complete data
5. **Auto-Stop**: System stops automatically when encountering existing bookmarks
6. **Combine**: Merge all extracted files into a single comprehensive collection
7. **Download Photos**: Save small-size copies of photos from your bookmarks and their quoted tweets

## 🔧 Usage

After setup, simply tell Claude Code to follow the instructions in `CLAUDE.md`. Claude will:

1. Navigate to your X bookmarks page (X now redirects this to History → Bookmarks)
2. Wait for you to login
3. Install the GraphQL interceptor and reload the bookmarks page, so the first page is captured (`bun build-interceptor-loader.ts`, see CLAUDE.md Step 3)
4. **For incremental updates**: Load the bookmark IDs from `data/x-bookmarks-latest.json`
5. Start auto-scroll manually
6. System auto-stops when it encounters 5 consecutive batches of existing bookmarks
7. Download JSON files with your bookmarks to `.playwright-mcp/`
8. Combine them into `data/x-bookmarks-latest.json` (CLAUDE.md Step 8)
9. Download photos to `data/media/` (CLAUDE.md Step 9, every run)

### 🔄 Incremental Updates (Recommended!)

Already extracted your bookmarks? The system can capture **only new bookmarks**. See [CLAUDE.md](CLAUDE.md) Steps 1–9 for the complete workflow, and [INCREMENTAL-UPDATE-GUIDE.md](INCREMENTAL-UPDATE-GUIDE.md) for a quick orientation.

## 📁 Output Files

- `x-bookmarks-graphql-*.json` - Individual extraction files (downloaded to `.playwright-mcp/` in the project)
- `data/x-bookmarks-latest.json` - Canonical collection (merged automatically by `bun combine-bookmarks.ts`)
- `data/x-bookmarks-combined-*.json` - Full merged snapshots, one per combine run (5 newest kept)
- `data/x-bookmarks-latest-backup-*.json` - Backups written before each update (5 newest kept)
- `data/media/<media id>.<ext>` - Small-size photos (up to 680px) from bookmarks and quoted tweets (`bun download-media.ts`, Step 9 in CLAUDE.md)

After every extraction, combine and then download photos (Steps 8 and 9 in CLAUDE.md):
```bash
# First, ensure bun is installed
# If not installed, run: curl -fsSL https://bun.sh/install | bash

BOOKMARK_FILES_DIR="$PWD/.playwright-mcp" CLEANUP_BATCH_FILES=1 bun combine-bookmarks.ts
bun download-media.ts
```

**Safety Features:**
- ✅ Automatic backup before overwriting `data/x-bookmarks-latest.json`
- ✅ Prevents data loss: Won't update if new file has fewer bookmarks
- ✅ Early exit if no files found (won't create empty files)
- ✅ Timestamped backups saved in `data/` (keeps 5 newest)
- ✅ Automatically includes existing `data/x-bookmarks-latest.json` in merge for seamless incremental updates
- ✅ Duplicate bookmarks are merged field by field: newer metrics and quoted tweets win, the earliest `capturedAt` is kept, and captured quote text survives if the quoted tweet is later deleted (see Step 8 in CLAUDE.md)

## 📊 Viewing Your Bookmarks

The project includes an interactive HTML viewer with:
- Advanced search (AND/OR operators, exclusions, exact phrases)
- Charts showing bookmark trends over time
- Trending terms and financial ticker detection
- Filters by year, engagement metrics, and media

**To view your bookmarks:**
```bash
./view-bookmarks.sh
```

This will start a local web server and open the viewer in your browser. Press `Ctrl+C` when done to stop the server.

**Search examples:**
- `china AND trade` - Both terms required
- `bitcoin OR ethereum` - Either term matches
- `"exact phrase"` - Must match exactly
- `-spam` - Exclude term

## 🔧 Troubleshooting

### "command not found: bun"
Install bun runtime:
```bash
curl -fsSL https://bun.sh/install | bash
exec $SHELL  # Restart shell to load bun
```

### Playwright tools disconnect ("Connection closed")
See CLAUDE.md Troubleshooting → "Playwright MCP server crashes on the first batch download". Run `/mcp` to reconnect.

### Fewer bookmarks on disk than the run captured
Browser downloads can be dropped silently. CLAUDE.md Step 8 has the check, and Troubleshooting → "Recovering lost batch saves" recovers them from page memory.

## 🧪 Running Tests

```bash
bun test
```

## 🙏 Credits

This project is heavily inspired by and builds upon the excellent [Twitter Web Exporter](https://github.com/prinsss/twitter-web-exporter) by [@prinsss](https://github.com/prinsss). All credit for the GraphQL interceptor techniques and approach goes to their original work.

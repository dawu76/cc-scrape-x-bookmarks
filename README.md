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
claude mcp add playwright npx @playwright/mcp@latest
```

### Step 3: Open Claude Code and Point to Instructions

Load Claude Code and point it to the `CLAUDE.md` file in this repository, which contains detailed step-by-step instructions for the extraction process.

## 🎯 How It Works

1. **Login**: Navigate to X bookmarks and login with your account
2. **Inject**: Load the GraphQL interceptor script that captures real API data
3. **Load Existing** (optional): Upload your previous bookmark file to enable incremental mode
4. **Extract**: Auto-scroll through your bookmarks while capturing complete data
5. **Auto-Stop**: System stops automatically when encountering existing bookmarks
6. **Combine**: Merge all extracted files into a single comprehensive collection

## 🔧 Usage

After setup, simply tell Claude Code to follow the instructions in `CLAUDE.md`. Claude will:

1. Navigate to your X bookmarks page
2. Wait for you to login
3. Inject the GraphQL interceptor (no auto-start version)
4. **For incremental updates**: Load your existing `x-bookmarks-latest.json` file
5. Start auto-scroll manually
6. System auto-stops when it encounters 5 consecutive batches of existing bookmarks
7. Download JSON files with your bookmarks

### 🔄 Incremental Updates (Recommended!)

Already extracted your bookmarks? The system can now capture **only new bookmarks**:

**How it works:**
1. Inject the interceptor (`interceptor-no-autostart.js`)
2. Upload your existing `x-bookmarks-latest.json` file
3. System loads 22,540+ existing bookmark IDs into memory
4. Start auto-scroll
5. New bookmarks are captured, existing ones are skipped
6. Auto-stops after 5 consecutive batches of all existing bookmarks

**Benefits:**
- Only captures what's new (seconds vs minutes)
- Automatically skips existing bookmarks
- Stops scrolling intelligently when reaching old bookmarks
- Saves time and bandwidth

**Required file:**
- `x-bookmarks-latest.json` (your previous extraction)

See `INCREMENTAL-UPDATE-GUIDE.md` for detailed instructions.

## 📁 Output Files

- `x-bookmarks-graphql-*.json` - Individual extraction files
- `x-bookmarks-combined-*.json` - All bookmarks in one file  
- `x-bookmarks-latest.json` - Easy access to most recent extraction

To combine multiple files:
```bash
bun combine-bookmarks.ts
```

## 🙏 Credits

This project is heavily inspired by and builds upon the excellent [Twitter Web Exporter](https://github.com/prinsss/twitter-web-exporter) by [@prinsss](https://github.com/prinsss). All credit for the GraphQL interceptor techniques and approach goes to their original work.

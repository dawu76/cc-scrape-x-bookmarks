# Command Reference: X Bookmarks Extraction & Analysis

> **Workflow commands live in [CLAUDE.md](CLAUDE.md).** This file holds only
> supplementary one-liners; if it disagrees with CLAUDE.md, CLAUDE.md wins.

This document contains supplementary shell commands for working with bookmark data.
`OUTPUT_DIR` defaults to `./data`; canonical data lives at `data/x-bookmarks-latest.json`.

## Working with Bookmark Data

### Viewing Bookmark Stats with jq

```bash
# Count total bookmarks
jq '.total_bookmarks' data/x-bookmarks-latest.json

# View export metadata
jq '.exported_at, .total_bookmarks, .source' data/x-bookmarks-latest.json

# Get first bookmark (pretty printed)
jq '.bookmarks[0]' data/x-bookmarks-latest.json

# Extract all bookmark URLs
jq '.bookmarks[].url' data/x-bookmarks-latest.json

# Get bookmarks from a specific user
jq '.bookmarks[] | select(.username == "elonmusk")' data/x-bookmarks-latest.json

# Count bookmarks by year
jq '.bookmarks | group_by(.timestamp[:4]) | map({year: .[0].timestamp[:4], count: length})' data/x-bookmarks-latest.json

# Find most liked bookmarks (top 10)
jq '.bookmarks | sort_by(-.metrics.likes) | .[0:10] | .[] | {username, likes: .metrics.likes, text: .text[:100]}' data/x-bookmarks-latest.json

# Count bookmarks with media
jq '[.bookmarks[] | select(.media | length > 0)] | length' data/x-bookmarks-latest.json

# Get date range of bookmarks
jq '[.bookmarks[].timestamp] | min, max' data/x-bookmarks-latest.json

# Quote tweets with the quoted tweet's author and text
jq '.bookmarks[] | select(.quotedTweet.text) | {username, text: .text[:100], quoted: "\(.quotedTweet.username): \(.quotedTweet.text[:100])"}' data/x-bookmarks-latest.json

# Quote tweets by status: captured, unavailable (deleted/protected), or not yet backfilled
jq '[.bookmarks[] | select(.isQuoteTweet)] | group_by(if .quotedTweet.text then "captured" elif .quotedTweet.unavailable then "unavailable" else "missing" end) | map({status: (if .[0].quotedTweet.text then "captured" elif .[0].quotedTweet.unavailable then "unavailable" else "missing" end), count: length})' data/x-bookmarks-latest.json
```

## Setting Up the Bookmark Viewer

### Starting a Local Web Server

```bash
# Preferred: starts a server on port 8080 and opens the viewer
./view-bookmarks.sh

# Manual equivalent, from the project root (so data/ is reachable)
python3 -m http.server 8080

# Access the viewer at:
# http://localhost:8080/bookmark-viewer.html
```

**To stop the server:** Press `Ctrl+C`

### Checking if Port is Already in Use

```bash
# Check what's running on port 8080
lsof -i :8080

# Kill a process using port 8080
lsof -ti :8080 | xargs kill
```

## Git Workflow for Forking

### Checking Current Git Status

```bash
# Check if directory is a git repository
git status

# View current remotes
git remote -v

# View commit history
git log --oneline -10
```

### Forking Workflow

```bash
# Step 1: Rename current origin to upstream
git remote rename origin upstream

# Step 2: Add your fork as new origin (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/cc-scrape-x-bookmarks.git

# Step 3: Verify remotes
git remote -v

# Should show:
# origin    https://github.com/YOUR_USERNAME/cc-scrape-x-bookmarks.git
# upstream  https://github.com/firstloophq/cc-scrape-x-bookmarks.git
```

### Committing and Pushing Changes

```bash
# Check which files have changed
git status

# Stage specific files
git add bookmark-viewer.html
git add interceptor-no-autostart.js
git add CLAUDE.md

# Or stage all changes
git add -A

# Commit with a descriptive message
git commit -m "Add financial terms panel and active filter management

- Added comprehensive ETF and S&P 100 stock ticker detection
- Separated tickers from financial keywords
- Added active filters UI with removable chips
- Fixed word boundary matching to prevent false positives"

# Push to your fork (first time)
git push -u origin main

# Push subsequent changes
git push origin main
```

### Keeping Your Fork Updated

```bash
# Fetch updates from original repository
git fetch upstream

# View what changed
git log HEAD..upstream/main --oneline

# Merge updates from upstream
git merge upstream/main

# Or rebase your changes on top of upstream
git rebase upstream/main

# Push updates to your fork
git push origin main
```

### Creating a Pull Request

```bash
# After pushing to your fork, create PR via GitHub CLI (if installed)
gh pr create --title "Add financial analysis features" --body "Description of changes"

# Or visit GitHub web interface:
# https://github.com/YOUR_USERNAME/cc-scrape-x-bookmarks
# Click "Contribute" → "Open pull request"
```

## Cleaning Up

### Removing Large Files

Batch and sentinel files are deleted automatically when you combine with
`CLEANUP_BATCH_FILES=1` (CLAUDE.md Step 8). Old backups and combined snapshots
are pruned to the newest 5 on every combine. To remove leftover batch files by
hand, only after they have been combined:

```bash
find .playwright-mcp -maxdepth 1 -type f \( -name 'x-bookmarks-graphql-*.json' -o -name 'x-bookmarks-DONE-*.json' \) -delete

# ⚠️ NEVER delete data/x-bookmarks-latest.json. It is the canonical copy of the
# collection (the 5 newest backups in data/ are the only other copies).
```

### Checking .gitignore

```bash
cat .gitignore
```

`data/` (collection, backups, snapshots, photos) and `.playwright-mcp/` (batch
files, logs) are already ignored. No other entries are needed.

## Useful Aliases (Optional)

Add these to your `~/.bashrc` or `~/.zshrc`:

```bash
# Git shortcuts
alias gs='git status'
alias ga='git add'
alias gc='git commit -m'
alias gp='git push'
alias gl='git log --oneline -10'

# Directory shortcuts
alias proj='cd /path/to/cc-scrape-x-bookmarks'

# Quick JSON pretty-print
alias json='jq .'

# Start web server in current directory
alias serve='python3 -m http.server 8080'
```

## Tips & Tricks

### Backup Before Deleting

```bash
# Create a backup before deleting files
mkdir -p ~/backups/bookmarks-$(date +%Y%m%d)
cp .playwright-mcp/x-bookmarks-graphql-*.json ~/backups/bookmarks-$(date +%Y%m%d)/
```

### Find Files by Date

```bash
# Find bookmark files modified in last 24 hours
find .playwright-mcp -name "x-bookmarks-graphql-*.json" -mtime -1

# Find files larger than 10MB
find .playwright-mcp -name "*.json" -size +10M
```

### Compress Old Bookmark Files

```bash
# Archive a run's batch files before combining with CLEANUP_BATCH_FILES=1
# (each file holds only its own batch, so keep all of them together)
tar -czf bookmarks-archive-$(date +%Y%m%d).tar.gz .playwright-mcp/x-bookmarks-*.json

# Extract compressed archive
tar -xzf bookmarks-archive.tar.gz
```

## Troubleshooting

### Permission Issues

```bash
# If you get permission denied
sudo chown -R $USER:$USER .playwright-mcp/

# Make script executable
chmod +x script.sh
```

### Port Already in Use

```bash
# Find process using port 8080 (the viewer's port)
lsof -i :8080

# Kill the process (replace PID)
kill -9 PID
```

### Git Authentication Issues

```bash
# Use HTTPS with personal access token
git remote set-url origin https://YOUR_TOKEN@github.com/YOUR_USERNAME/cc-scrape-x-bookmarks.git

# Or use SSH
git remote set-url origin git@github.com:YOUR_USERNAME/cc-scrape-x-bookmarks.git
```

---

**Created:** 2025-10-14
**Project:** X Bookmarks Extraction & Analysis
**Original Repo:** https://github.com/firstloophq/cc-scrape-x-bookmarks

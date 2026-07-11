# Command Reference: X Bookmarks Extraction & Analysis

> **Workflow commands live in [CLAUDE.md](CLAUDE.md).** This file holds only
> supplementary one-liners; if it disagrees with CLAUDE.md, CLAUDE.md wins.

This document contains supplementary shell commands for working with bookmark data.
`OUTPUT_DIR` defaults to `./data`; canonical data lives at `data/data/x-bookmarks-latest.json`.

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
```

## Setting Up the Bookmark Viewer

### Starting a Local Web Server

```bash
# Start Python HTTP server on port 8000
python3 -m http.server 8000

# Alternative: Start on a different port
python3 -m http.server 3000

# Access the viewer at:
# http://localhost:8000/bookmark-viewer.html
```

**To stop the server:** Press `Ctrl+C`

### Checking if Port is Already in Use

```bash
# Check what's running on port 8000
lsof -i :8000

# Kill a process using port 8000
lsof -ti :8000 | xargs kill
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

```bash
# Remove all downloaded bookmark files
rm ~/.playwright-mcp/x-bookmarks-graphql-*.json

# Remove local copy (if too large to commit)
rm data/x-bookmarks-latest.json
```

### Checking .gitignore

```bash
# View current .gitignore
cat .gitignore

# Add files to .gitignore
echo "data/x-bookmarks-latest.json" >> .gitignore
echo "*.json" >> .gitignore
echo "node_modules/" >> .gitignore
```

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
alias serve='python3 -m http.server 8000'
```

## Tips & Tricks

### Backup Before Deleting

```bash
# Create a backup before deleting files
mkdir -p ~/backups/bookmarks-$(date +%Y%m%d)
cp ~/.playwright-mcp/x-bookmarks-graphql-*.json ~/backups/bookmarks-$(date +%Y%m%d)/
```

### Find Files by Date

```bash
# Find bookmark files modified in last 24 hours
find ~/.playwright-mcp -name "x-bookmarks-graphql-*.json" -mtime -1

# Find files larger than 10MB
find ~/.playwright-mcp -name "*.json" -size +10M
```

### Compress Old Bookmark Files

```bash
# Compress all but the latest file
ls -t ~/.playwright-mcp/x-bookmarks-graphql-*.json | tail -n +2 | xargs tar -czf bookmarks-archive.tar.gz

# Extract compressed archive
tar -xzf bookmarks-archive.tar.gz
```

## Troubleshooting

### Permission Issues

```bash
# If you get permission denied
sudo chown -R $USER:$USER ~/.playwright-mcp/

# Make script executable
chmod +x script.sh
```

### Port Already in Use

```bash
# Find process using port 8000
lsof -i :8000

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

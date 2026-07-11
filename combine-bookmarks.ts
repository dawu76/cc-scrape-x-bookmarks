#!/usr/bin/env bun

// Script to combine all GraphQL bookmark files into a single comprehensive file
import { mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';

// Check if running with bun
if (typeof Bun === 'undefined') {
  console.error('❌ Error: This script requires Bun runtime.');
  console.error('');
  console.error('📦 Install Bun:');
  console.error('   curl -fsSL https://bun.sh/install | bash');
  console.error('   exec $SHELL  # Restart your shell');
  console.error('');
  console.error('🚀 Then run:');
  console.error('   bun combine-bookmarks.ts');
  process.exit(1);
}

interface BookmarkData {
  exported_at: string;
  total_bookmarks: number;
  source: string;
  bookmarks: Bookmark[];
}

interface Bookmark {
  id: string;
  url: string;
  username: string;
  displayName: string;
  isVerified: boolean;
  text: string;
  timestamp: string;
  metrics: {
    replies: number;
    retweets: number;
    likes: number;
    bookmarks: number;
    views: number;
  };
  media: any[];
  isRetweet: boolean;
  isQuoteTweet: boolean;
  capturedAt: string;
  source: string;
}

interface CombinedData {
  exported_at: string;
  total_bookmarks: number;
  total_processed: number;
  total_duplicates: number;
  files_processed: number;
  source: string;
  version: string;
  bookmarks: Bookmark[];
}

console.log('🔄 Starting bookmark combination process...');

// Configure download directory - update this path based on where your files are saved
// Common locations:
// - Downloads: `${process.env.HOME}/Downloads`
// - Playwright temp: `/var/folders/.../playwright-mcp-output`
// - Current directory: `.`
const downloadsDir = process.env.BOOKMARK_FILES_DIR;
if (!downloadsDir) {
  console.error('❌ BOOKMARK_FILES_DIR is required. Set it to the directory containing your bookmark JSON files.');
  console.error('   Example: BOOKMARK_FILES_DIR=~/Downloads bun combine-bookmarks.ts');
  process.exit(1);
}

const outputDir = process.env.OUTPUT_DIR || './data';
mkdirSync(outputDir, { recursive: true });

console.log(`📁 Searching for files in: ${downloadsDir}`);

// Recursively find bookmark files without shelling out (no quoting pitfalls)
function findBookmarkFiles(rootDir: string): string[] {
  const results: string[] = [];
  const isBookmarkFile = (name: string) =>
    /^x-bookmarks-graphql-.*\.json$/.test(name) ||
    /^x-bookmarks-combined-.*\.json$/.test(name) ||
    name === 'x-bookmarks-latest.json';
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory: skip, matching find's tolerance
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && isBookmarkFile(entry.name)) results.push(full);
    }
  };
  walk(rootDir);
  return results;
}

const files = findBookmarkFiles(downloadsDir);

console.log(`📁 Found ${files.length} bookmark file(s)`);

// Always merge the canonical collection so incremental runs never drop history
const canonicalLatest = resolve(outputDir, 'x-bookmarks-latest.json');
const resolvedFiles = files.map(f => resolve(f));
if (await Bun.file(canonicalLatest).exists() && !resolvedFiles.includes(canonicalLatest)) {
  files.push(canonicalLatest);
}

// Safety check: Exit early if no files found
if (files.length === 0) {
  console.log('❌ No bookmark files found. Exiting without creating empty files to preserve existing data.');
  console.log(`💡 Searched in: ${downloadsDir}`);
  console.log(`💡 Use BOOKMARK_FILES_DIR environment variable to specify a different directory.`);
  process.exit(0);
}

// Use Map to deduplicate bookmarks by ID
const allBookmarks = new Map<string, Bookmark>();
let totalProcessed = 0;
let totalDuplicates = 0;

// Process each file
for (const filePath of files) {
  try {
    console.log(`📖 Processing: ${filePath.split('/').pop()}`);
    
    const file = Bun.file(filePath);
    const content = await file.text();
    const data: BookmarkData = JSON.parse(content);
    
    if (data.bookmarks && Array.isArray(data.bookmarks)) {
      for (const bookmark of data.bookmarks) {
        if (bookmark.id) {
          if (allBookmarks.has(bookmark.id)) {
            totalDuplicates++;
          } else {
            allBookmarks.set(bookmark.id, bookmark);
          }
          totalProcessed++;
        }
      }
      console.log(`  ✅ Added ${data.bookmarks.length} bookmarks (${data.total_bookmarks || 'unknown'} total in file)`);
    }
  } catch (error) {
    console.warn(`  ⚠️  Error processing ${filePath}:`, error);
  }
}

// Convert Map to Array and sort by timestamp (newest first)
const uniqueBookmarks = Array.from(allBookmarks.values()).sort((a, b) => {
  const timeA = new Date(a.timestamp || a.capturedAt || 0);
  const timeB = new Date(b.timestamp || b.capturedAt || 0);
  return timeB.getTime() - timeA.getTime();
});

// Create final combined data structure
const combinedData: CombinedData = {
  exported_at: new Date().toISOString(),
  total_bookmarks: uniqueBookmarks.length,
  total_processed: totalProcessed,
  total_duplicates: totalDuplicates,
  files_processed: files.length,
  source: 'combined-graphql-interceptor',
  version: '1.0',
  bookmarks: uniqueBookmarks
};

// Generate timestamp for filename
const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
const outputPath = `${outputDir}/x-bookmarks-combined-${timestamp}.json`;

// Show summary before writing
console.log('\n📊 Pre-save validation:');
console.log(`   • Will save: ${uniqueBookmarks.length} unique bookmarks`);
console.log(`   • Output file: x-bookmarks-combined-${timestamp}.json`);

// Write combined file
await Bun.write(outputPath, JSON.stringify(combinedData, null, 2));

console.log('\n🎉 Bookmark combination completed!');
console.log(`📊 Statistics:`);
console.log(`   • Files processed: ${files.length}`);
console.log(`   • Total bookmarks processed: ${totalProcessed}`);
console.log(`   • Duplicate bookmarks removed: ${totalDuplicates}`);
console.log(`   • Final unique bookmarks: ${uniqueBookmarks.length}`);
console.log(`📄 Combined file saved to: ${outputPath}`);

// Also create a latest.json for easy access (with safety checks)
const latestPath = `${outputDir}/x-bookmarks-latest.json`;

// Safety check 1: Don't overwrite if we have 0 bookmarks
if (uniqueBookmarks.length === 0) {
  console.log('⚠️  WARNING: No bookmarks to save. Skipping latest.json update to preserve existing data.');
} else {
  try {
    // Safety check 2: Check if existing latest.json has MORE bookmarks
    let shouldUpdate = true;
    const latestFile = Bun.file(latestPath);

    if (await latestFile.exists() && latestFile.size > 0) {
      const existingContent = await latestFile.text();
      const existingData = JSON.parse(existingContent);
      const existingCount = existingData.total_bookmarks || 0;

      if (existingCount > uniqueBookmarks.length) {
        console.log(`\n⚠️  WARNING: Existing latest.json has ${existingCount} bookmarks, but new file only has ${uniqueBookmarks.length}.`);
        console.log(`⚠️  This would result in DATA LOSS of ${existingCount - uniqueBookmarks.length} bookmarks. Skipping update.`);
        console.log(`💡 To force update, manually delete or rename the existing latest.json file.`);
        shouldUpdate = false;

        // Create a backup just in case
        const backupPath = `${outputDir}/x-bookmarks-latest-backup-${timestamp}.json`;
        await Bun.write(backupPath, existingContent);
        console.log(`📦 Existing file backed up to: ${backupPath}`);
      } else {
        // Create backup before updating (existing file will be replaced)
        const backupPath = `${outputDir}/x-bookmarks-latest-backup-${timestamp}.json`;
        await Bun.write(backupPath, existingContent);
        console.log(`📦 Previous version backed up to: ${backupPath}`);
      }
    }

    if (shouldUpdate) {
      await Bun.write(latestPath, JSON.stringify(combinedData, null, 2));
      console.log(`🔗 Latest file updated at: ${latestPath}`);

      // Retention: keep only the 5 newest latest-backups (ISO names sort chronologically)
      const BACKUPS_TO_KEEP = 5;
      const backups = readdirSync(outputDir)
        .filter((f) => /^x-bookmarks-latest-backup-.*\.json$/.test(f))
        .sort();
      for (const oldBackup of backups.slice(0, Math.max(0, backups.length - BACKUPS_TO_KEEP))) {
        unlinkSync(join(outputDir, oldBackup));
        console.log(`🧹 Pruned old backup: ${oldBackup}`);
      }
    }
  } catch (error) {
    console.warn(`⚠️  Could not update latest file:`, error);
  }
}

console.log('\n✨ All done! Your complete bookmark collection is ready.');
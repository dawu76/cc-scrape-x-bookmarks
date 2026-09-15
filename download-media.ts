#!/usr/bin/env bun

// Downloads small-size photos (X's `name=small`, at most 680px on the long
// side) referenced by the bookmark collection, from
// both bookmarks and their quoted tweets. Videos and GIFs are skipped: their
// stored URL is only a preview frame, and the tweet link is kept in the JSON.
//
// Files land in MEDIA_DIR as <media id>.<ext>. Re-runs skip files already on
// disk. Failures go to MEDIA_DIR/failed.json; permanent ones (image or tweet
// gone) are not retried, transient ones are.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { extname, join } from 'path';

const inputFile = process.env.INPUT_FILE || './data/x-bookmarks-latest.json';
const mediaDir = process.env.MEDIA_DIR || './data/media';
const CONCURRENCY = 4;
const PERMANENT_STATUSES = new Set([403, 404, 410]);
const TIMEOUT_MS = 30_000;

interface MediaItem {
  id: string;
  type: string;
  url: string;
}

interface Failure {
  status: number; // HTTP status, or 0 for a network error or timeout
  url: string;
  lastTried: string;
}

if (!existsSync(inputFile)) {
  console.error(`❌ Collection not found: ${inputFile}`);
  process.exit(1);
}

const collection = JSON.parse(readFileSync(inputFile, 'utf8'));

// Photos from bookmarks and quoted tweets, deduplicated by media ID
const photos = new Map<string, MediaItem>();
for (const bookmark of collection.bookmarks ?? []) {
  for (const item of [...(bookmark.media ?? []), ...(bookmark.quotedTweet?.media ?? [])]) {
    if (item.type === 'photo' && item.id && item.url) photos.set(item.id, item);
  }
}

mkdirSync(mediaDir, { recursive: true });
const failedPath = join(mediaDir, 'failed.json');
const failed: Record<string, Failure> = existsSync(failedPath)
  ? JSON.parse(readFileSync(failedPath, 'utf8'))
  : {};
// Only write when there is something to record, or to persist cleared entries
const saveFailed = () => {
  if (Object.keys(failed).length > 0 || existsSync(failedPath)) {
    writeFileSync(failedPath, JSON.stringify(failed, null, 2));
  }
};

const fileName = (item: MediaItem) => `${item.id}${extname(new URL(item.url).pathname) || '.jpg'}`;
const onDisk = new Set(readdirSync(mediaDir));

let alreadyOnDisk = 0;
let knownGone = 0;
const queue: MediaItem[] = [];
for (const item of photos.values()) {
  if (onDisk.has(fileName(item))) alreadyOnDisk++;
  else if (PERMANENT_STATUSES.has(failed[item.id]?.status)) knownGone++;
  else queue.push(item);
}

console.log(`🖼️  ${photos.size} photos: ${alreadyOnDisk} on disk, ${knownGone} known gone, ${queue.length} to download`);

let downloaded = 0;
let bytes = 0;
let newFailures = 0;

async function download(item: MediaItem) {
  const url = new URL(item.url);
  url.searchParams.set('name', 'small');
  const recordFailure = (status: number) => {
    failed[item.id] = { status, url: item.url, lastTried: new Date().toISOString() };
    newFailures++;
  };

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return recordFailure(res.status);

    // Write to .part and rename, so an interrupted run never leaves a
    // truncated file that a later run would count as done.
    const body = await res.arrayBuffer();
    const partPath = join(mediaDir, `${fileName(item)}.part`);
    writeFileSync(partPath, new Uint8Array(body));
    renameSync(partPath, join(mediaDir, fileName(item)));

    delete failed[item.id];
    downloaded++;
    bytes += body.byteLength;
  } catch {
    recordFailure(0);
  }
}

let next = 0;
let done = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < queue.length) {
      await download(queue[next++]);
      if (++done % 500 === 0) {
        saveFailed();
        console.log(`   ${done}/${queue.length} (${(bytes / 1048576).toFixed(0)} MB)`);
      }
    }
  })
);
saveFailed();

console.log(
  `✅ Media: downloaded ${downloaded} (${(bytes / 1048576).toFixed(1)} MB), ` +
  `failed ${newFailures}, skipped ${alreadyOnDisk + knownGone}`
);

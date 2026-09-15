import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Local stand-in for pbs.twimg.com. Records every request path+query.
const requests: string[] = [];
let flakyCalls = 0;
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    requests.push(url.pathname + url.search);
    if (url.pathname === "/media/gone.jpg") return new Response("", { status: 403 });
    if (url.pathname === "/media/flaky.png") {
      flakyCalls++;
      return flakyCalls === 1 ? new Response("", { status: 500 }) : new Response("png-bytes");
    }
    return new Response(`bytes of ${url.pathname}`);
  }
});
afterAll(() => server.stop(true));

const base = `http://localhost:${server.port}/media`;

function media(id: string, file: string, type = "photo") {
  return { id, type, url: `${base}/${file}`, expanded_url: `https://x.com/u/status/1/photo/1`, alt_text: "" };
}

function writeCollection(path: string, bookmarks: object[]) {
  writeFileSync(path, JSON.stringify({ total_bookmarks: bookmarks.length, bookmarks }));
}

async function runDownload(env: Record<string, string>) {
  const proc = Bun.spawn(["bun", "download-media.ts"], {
    cwd: import.meta.dir + "/..",
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe"
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { output: stdout + stderr, code: await proc.exited };
}

function setup(bookmarks: object[]) {
  const dir = mkdtempSync(join(tmpdir(), "bm-media-"));
  const input = join(dir, "x-bookmarks-latest.json");
  const mediaDir = join(dir, "media");
  writeCollection(input, bookmarks);
  return { input, mediaDir, env: { INPUT_FILE: input, MEDIA_DIR: mediaDir } };
}

test("downloads small-size photos from bookmarks and quoted tweets, skipping video", async () => {
  requests.length = 0;
  const { mediaDir, env } = setup([
    { id: "1", media: [media("101", "a.jpg"), media("102", "clip.jpg", "video")] },
    { id: "2", media: [], quotedTweet: { id: "3", media: [media("301", "q.png"), media("302", "g.jpg", "animated_gif")] } },
    { id: "4", media: [media("101", "a.jpg")] } // same image bookmarked twice
  ]);

  const { code, output } = await runDownload(env);
  expect(code).toBe(0);

  expect(readdirSync(mediaDir).sort()).toEqual(["101.jpg", "301.png"]);
  expect(readFileSync(join(mediaDir, "101.jpg"), "utf8")).toBe("bytes of /media/a.jpg");
  expect(requests.sort()).toEqual(["/media/a.jpg?name=small", "/media/q.png?name=small"]);
  expect(output).toContain("downloaded 2");
});

test("a second run skips files already on disk", async () => {
  const { env } = setup([{ id: "1", media: [media("111", "b.jpg")] }]);
  await runDownload(env);
  requests.length = 0;

  const { code, output } = await runDownload(env);
  expect(code).toBe(0);
  expect(requests).toEqual([]);
  expect(output).toContain("downloaded 0");
});

test("permanent failures are recorded and not retried; transient ones are retried", async () => {
  flakyCalls = 0;
  const { mediaDir, env } = setup([
    { id: "1", media: [media("121", "gone.jpg"), media("122", "flaky.png")] }
  ]);

  await runDownload(env);
  const failed = JSON.parse(readFileSync(join(mediaDir, "failed.json"), "utf8"));
  expect(failed["121"].status).toBe(403);
  expect(failed["122"].status).toBe(500);
  expect(existsSync(join(mediaDir, "121.jpg"))).toBe(false);

  requests.length = 0;
  await runDownload(env);
  expect(requests).toEqual(["/media/flaky.png?name=small"]); // 403 not retried
  expect(readFileSync(join(mediaDir, "122.png"), "utf8")).toBe("png-bytes");
  const after = JSON.parse(readFileSync(join(mediaDir, "failed.json"), "utf8"));
  expect(after["122"]).toBeUndefined();
  expect(after["121"].status).toBe(403);
});

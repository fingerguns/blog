/**
 * Generate 252×252 JPEG posters for existing Thinking videos and upload to R2.
 * Run from project root: node --env-file=.env scripts/backfill-video-posters.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegStatic from "ffmpeg-static";
import { d1Configured, loadBlogDataFromD1 } from "./d1-client.mjs";
import { videoPosterKeyFromVideoUrl } from "./lib/media-url.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const workerDir = join(root, "worker");
const base = "https://rommy.blog";
const bucket = "rommy-blog-media";

function videoSrcFromHtml(html) {
  const str = String(html || "");
  const m =
    str.match(/<video[^>]+class=["'][^"']*thinking-video[^"']*["'][^>]+src=["']([^"']+)["']/i) ||
    str.match(/<video[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*thinking-video[^"']*["']/i);
  if (!m) return "";
  return m[1].replace(/#t=0\.001$/, "");
}

async function posterExists(posterKey) {
  try {
    const res = await fetch(`${base}/media/${posterKey}`, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

function extractPoster(videoUrl, outPath) {
  if (!ffmpegStatic) {
    throw new Error("ffmpeg-static binary is unavailable on this platform.");
  }
  const result = spawnSync(
    ffmpegStatic,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "0.001",
      "-i",
      videoUrl,
      "-frames:v",
      "1",
      "-vf",
      "scale=252:252:force_original_aspect_ratio=increase,crop=252:252",
      "-q:v",
      "4",
      "-y",
      outPath,
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || "ffmpeg failed");
    return false;
  }
  return existsSync(outPath);
}

function uploadPoster(posterKey, filePath) {
  const childEnv = { ...process.env };
  delete childEnv.CF_API_TOKEN;
  delete childEnv.CLOUDFLARE_API_TOKEN;
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "r2",
      "object",
      "put",
      `${bucket}/${posterKey}`,
      `--file=${filePath}`,
      "--content-type=image/jpeg",
      "--remote",
    ],
    {
      cwd: workerDir,
      encoding: "utf8",
      env: childEnv,
    }
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || "wrangler r2 put failed");
    return false;
  }
  return true;
}

if (!d1Configured()) {
  console.error("D1 is not configured — set CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID, D1_API_TOKEN.");
  process.exit(1);
}

console.log("Loading Thinking posts from D1…");
const data = await loadBlogDataFromD1();
const items = data.thinkingPosts || [];
const videoSrcs = [
  ...new Set(items.map((item) => videoSrcFromHtml(item.content_html)).filter(Boolean)),
];

console.log(`Found ${videoSrcs.length} native video post(s).`);
const tmpDir = mkdtempSync(join(tmpdir(), "video-posters-"));
let created = 0;
let skipped = 0;
let failed = 0;

try {
  for (const videoSrc of videoSrcs) {
    const posterKey = videoPosterKeyFromVideoUrl(videoSrc, base);
    if (!posterKey) {
      console.log(`  skip (not on rommy.blog): ${videoSrc}`);
      skipped++;
      continue;
    }
    if (await posterExists(posterKey)) {
      console.log(`  exists: ${posterKey}`);
      skipped++;
      continue;
    }

    const outPath = join(tmpDir, posterKey.replace(/\//g, "_"));
    console.log(`  generating: ${posterKey}`);
    if (!extractPoster(videoSrc, outPath)) {
      failed++;
      continue;
    }
    if (!uploadPoster(posterKey, outPath)) {
      failed++;
      continue;
    }
    created++;
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`Done. created=${created} skipped=${skipped} failed=${failed}`);
if (created > 0) {
  console.log("Run npm run build to refresh the grid poster cache.");
}

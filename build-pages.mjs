/**
 * Cloudflare Pages build script.
 * Runs the normal build then copies only site files into dist/,
 * keeping node_modules and dev tooling out of the deployed assets.
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";

// Cloudflare Pages clones with depth 1; changelog needs full git history.
try {
  const shallow = execSync("git rev-parse --is-shallow-repository", { encoding: "utf8" }).trim();
  if (shallow === "true") {
    console.log("Fetching full git history for changelog…");
    try {
      execSync("git fetch --unshallow", { stdio: "inherit" });
    } catch {
      execSync("git fetch --depth=10000", { stdio: "inherit" });
    }
  }
} catch (e) {
  console.warn("Could not expand git history:", e.message);
}

execSync("node scripts/build.mjs", { stdio: "inherit" });

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");

const entries = [
  "index.html",
  "feed.xml",
  "robots.txt",
  "sitemap.xml",
  "styles.css",
  "favicon.png",
  "about",
  "admin",
  "changelog",
  "colophon",
  "contact",
  "microblog",
  "now",
  "posts",
  "thinking",
];

for (const entry of entries) {
  if (existsSync(entry)) {
    cpSync(entry, `dist/${entry}`, { recursive: true });
  }
}

console.log("dist/ ready for Cloudflare Pages.");

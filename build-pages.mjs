/**
 * Cloudflare Pages build script.
 * Runs the normal build then copies only site files into dist/,
 * keeping node_modules and dev tooling out of the deployed assets.
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";

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

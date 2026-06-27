/**
 * Cloudflare Pages build script.
 * Expands git history for changelog, then runs scripts/build.mjs → dist/.
 */
import { execSync } from "node:child_process";

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

console.log("dist/ ready for Cloudflare Pages.");

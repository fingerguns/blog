// Right-click menu: "Share link to rommy.blog" on a link, and "Share page to
// rommy.blog" on the page itself. The result shows as a badge on the toolbar
// button (✓ green, ! red), with the details in its tooltip.
import { isShareable, shareLink, warningsOf } from "./api.js";

const DEFAULT_TITLE = "Share to rommy.blog";

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "share-link",
      title: "Share link to rommy.blog",
      contexts: ["link"],
      targetUrlPatterns: ["http://*/*", "https://*/*"],
    });
    chrome.contextMenus.create({
      id: "share-page",
      title: "Share page to rommy.blog",
      contexts: ["page"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
  });
  // First install: open the options so the share token can go in.
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

let badgeTimer = null;
async function flash(ok, tooltip) {
  clearTimeout(badgeTimer);
  await chrome.action.setBadgeBackgroundColor({ color: ok ? "#2f7d4f" : "#c2383d" });
  await chrome.action.setBadgeText({ text: ok ? "✓" : "!" });
  await chrome.action.setTitle({ title: tooltip });
  badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: DEFAULT_TITLE });
  }, ok ? 4000 : 12000);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // A link's own page title is fetched by the Worker; the page's comes from the tab.
  const url = info.menuItemId === "share-link" ? info.linkUrl : info.pageUrl || tab?.url;
  const title = info.menuItemId === "share-page" ? tab?.title || "" : "";
  if (!isShareable(url)) return flash(false, "Only web pages (http or https) can be shared.");
  await chrome.action.setBadgeBackgroundColor({ color: "#666666" });
  await chrome.action.setBadgeText({ text: "…" });
  try {
    const result = await shareLink(url, title);
    const warnings = warningsOf(result);
    const name = result.entry?.title || url;
    await flash(
      !warnings.length,
      warnings.length ? `Shared "${name}", but:\n${warnings.join("\n")}` : `Shared "${name}" to rommy.blog`
    );
  } catch (err) {
    await flash(false, `Not shared: ${err.message}`);
  }
});

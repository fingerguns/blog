# Share to rommy.blog (Chrome extension)

Adds the page you're on, or a link on it, to Sharing on rommy.blog. It works in
Chrome and other Chromium browsers (Brave, Arc, Edge).

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this `extension/` folder.
3. The options page opens: paste the share token (the `SHARE_TOKEN` Worker
   secret, the one the "Share to rommy.blog" Shortcut uses) and press
   **Save and test**. It is saved only if rommy.blog accepts it.
4. Pin the extension (the puzzle-piece menu) so its button stays in the toolbar.

## Use

- **Toolbar button, or ⌥⇧S:** a small panel shows the page's title, which you
  can edit (blank lets the Worker read the page's own title), and the URL.
  **Share** or Enter posts it. A clean share closes the panel; cross-post
  warnings stay on screen.
- **Right-click a link:** "Share link to rommy.blog" posts the link. The Worker
  reads the title from the linked page.
- **Right-click the page:** "Share page to rommy.blog" posts the page with its
  tab title.

A right-click share reports on the toolbar button: a green ✓, or a red ! whose
tooltip says what went wrong.

## How it works

Everything is one request, `POST https://rommy.blog/api/admin` with
`{ action: "sharing", share_token, url, title }` (`shareLink` in `api.js`), the
same call the Shortcut makes. The share token can add a Sharing link and nothing
else; the Worker refuses it for every other action. It is kept in
`chrome.storage.local`, so it stays in this browser and isn't synced, and it is
never in this folder or the repo.

The extension's only host permission is `https://rommy.blog/*`. `activeTab`
gives it the current tab's URL and title when you click the button or press the
shortcut, and nothing otherwise. No page content is read.

After changing a file here, press the reload arrow on the extension's card in
`chrome://extensions`.

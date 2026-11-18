import { API_URL, getToken } from "./api.js";

const input = document.getElementById("token");
const saveBtn = document.getElementById("save");
const clearBtn = document.getElementById("clear");
const status = document.getElementById("status");

function say(kind, message) {
  status.hidden = false;
  status.className = `status ${kind}`;
  status.textContent = message;
}

if (await getToken()) {
  input.placeholder = "Saved — paste a new one to replace it";
}

// Checks the token without adding anything: a Sharing request with no URL is
// answered "Missing url" (400) only after the token has been accepted, and
// "Invalid share token" (401) when it hasn't.
async function test(token) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sharing", share_token: token, url: "" }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 400 && data.error === "Missing url") return "ok";
  if (res.status === 401) return "refused";
  return data.error || `rommy.blog answered ${res.status}`;
}

saveBtn.addEventListener("click", async () => {
  const token = input.value.trim();
  if (!token) {
    say("bad", (await getToken()) ? "Already saved. Paste a new token to replace it." : "Paste the token first.");
    return;
  }
  saveBtn.disabled = true;
  say("", "Testing…");
  try {
    const result = await test(token);
    if (result === "ok") {
      await chrome.storage.local.set({ shareToken: token });
      input.value = "";
      input.placeholder = "Saved — paste a new one to replace it";
      say("ok", "✓ Saved. rommy.blog accepted the token.");
    } else if (result === "refused") {
      say("bad", "rommy.blog refused that token, so it wasn't saved.");
    } else {
      say("bad", `Couldn't check the token: ${result}`);
    }
  } catch {
    say("bad", "Couldn't reach rommy.blog. Check your connection.");
  } finally {
    saveBtn.disabled = false;
  }
});

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove("shareToken");
  input.placeholder = "";
  say("ok", "Removed.");
});

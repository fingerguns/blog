(function () {
  var theme = "light";
  try {
    theme = new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light";
  } catch (e) {}
  if (theme !== "dark") return;
  var root = document.documentElement;
  root.classList.add("dark");
  root.style.colorScheme = "dark";
  function markBody() {
    if (!document.body) return;
    document.body.classList.add("dark");
    document.body.style.colorScheme = "dark";
  }
  markBody();
  if (!document.body) {
    new MutationObserver(function () {
      if (document.body) {
        markBody();
        this.disconnect();
      }
    }).observe(document.documentElement, { childList: true });
  }
})();

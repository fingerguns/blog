/* Apply theme from iframe URL before Remark42 CSS paints (patched into iframe.html). */
(function () {
  var theme = "light";
  try {
    var params = new URLSearchParams(window.location.search);
    theme = params.get("theme") === "dark" ? "dark" : "light";
  } catch (e) {}
  var root = document.documentElement;
  root.style.colorScheme = theme;
  if (theme === "dark") {
    root.classList.add("dark");
    document.addEventListener("DOMContentLoaded", function () {
      document.body.classList.add("dark");
    });
  }
})();

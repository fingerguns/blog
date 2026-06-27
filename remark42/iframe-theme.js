/* Apply body.dark from iframe URL before Remark42 paints. */
(function () {
  var theme = "light";
  try {
    theme = new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light";
  } catch (e) {}
  if (theme !== "dark") return;
  document.documentElement.classList.add("dark");
  document.documentElement.style.colorScheme = "dark";
  document.addEventListener("DOMContentLoaded", function () {
    document.body.classList.add("dark");
    document.body.style.colorScheme = "dark";
  });
})();

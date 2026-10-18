// Remembers a chosen language and sends first-time visitors with a non-German browser to /en/.
(function () {
  try {
    var key = "kabine-site-lang";
    document.querySelectorAll("a[data-lang]").forEach(function (a) {
      a.addEventListener("click", function () {
        localStorage.setItem(key, a.getAttribute("data-lang"));
      });
    });
    var lang = navigator.language || "de";
    if (location.pathname === "/" && !localStorage.getItem(key) && !/^de/i.test(lang)) location.replace("/en/");
  } catch (e) {
    // storage blocked: stay on the page
  }
})();

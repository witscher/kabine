// Language: remembers a chosen language and offers the other version of the page to visitors whose
// browser speaks it. No automatic redirect: search engines must see every page as it is.
(function () {
  try {
    var key = "kabine-site-lang";
    document.querySelectorAll("a[data-lang]").forEach(function (a) {
      a.addEventListener("click", function () {
        localStorage.setItem(key, a.getAttribute("data-lang"));
      });
    });
    var page = document.documentElement.lang;
    var browser = /^de/i.test(navigator.language || "") ? "de" : "en";
    if (localStorage.getItem(key) || browser === page) return;
    var other = document.querySelector('link[rel="alternate"][hreflang="' + browser + '"]');
    if (!other) return;
    var bar = document.createElement("div");
    bar.className = "lang-hint";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", browser === "en" ? "Language" : "Sprache");
    var text = document.createElement("span");
    text.textContent = browser === "en" ? "This page is also available in English." : "Diese Seite gibt es auch auf Deutsch.";
    var link = document.createElement("a");
    link.href = new URL(other.href).pathname;
    link.textContent = browser === "en" ? "Switch to English" : "Auf Deutsch lesen";
    link.addEventListener("click", function () {
      localStorage.setItem(key, browser);
    });
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", browser === "en" ? "Stay on this page" : "Auf dieser Seite bleiben");
    close.addEventListener("click", function () {
      localStorage.setItem(key, page);
      bar.remove();
    });
    bar.append(text, link, close);
    document.body.prepend(bar);
  } catch (e) {
    // storage blocked: no hint
  }
})();

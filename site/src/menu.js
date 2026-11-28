// Menu on phones: a burger button opens the header links as a list below the bar. Without JavaScript the
// links stay in the header and wrap (style.css hides them only with the class "js").
(function () {
  var top = document.querySelector(".top");
  var nav = top && top.querySelector("nav");
  if (!nav) return;
  document.documentElement.classList.add("js");
  var de = document.documentElement.lang === "de";
  nav.id = nav.id || "top-nav";
  var button = document.createElement("button");
  button.type = "button";
  button.className = "burger";
  button.setAttribute("aria-controls", nav.id);
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", de ? "Menü" : "Menu");
  button.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>';
  nav.parentNode.insertBefore(button, nav.nextSibling);
  function set(open) {
    top.classList.toggle("menu-open", open);
    button.setAttribute("aria-expanded", String(open));
  }
  button.addEventListener("click", function () {
    set(!top.classList.contains("menu-open"));
  });
  // A link (also an anchor on the same page) closes the menu, as do Escape and a wide window
  nav.addEventListener("click", function (e) {
    if (e.target.closest("a")) set(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && top.classList.contains("menu-open")) {
      set(false);
      button.focus();
    }
  });
  window.matchMedia("(min-width: 961px)").addEventListener("change", function (m) {
    if (m.matches) set(false);
  });
})();

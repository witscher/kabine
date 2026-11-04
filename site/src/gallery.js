// Screenshots: a click opens them large in a lightbox, with previous/next (buttons, arrow keys, swipe).
// Without JavaScript the gallery stays as it is.
(function () {
  var galleries = document.querySelectorAll(".gallery");
  if (!galleries.length || typeof HTMLDialogElement !== "function") return;
  var de = document.documentElement.lang === "de";
  var L = de
    ? { open: "Groß anzeigen: ", close: "Schließen", prev: "Vorheriges Bild", next: "Nächstes Bild", of: " von " }
    : { open: "Show large: ", close: "Close", prev: "Previous image", next: "Next image", of: " of " };

  var dialog = document.createElement("dialog");
  dialog.className = "lightbox";
  dialog.setAttribute("aria-label", de ? "Bilder" : "Screenshots");
  var figure = document.createElement("figure");
  var img = document.createElement("img");
  var caption = document.createElement("figcaption");
  figure.append(img, caption);
  function button(cls, label, text) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.setAttribute("aria-label", label);
    b.textContent = text;
    return b;
  }
  var close = button("lb-close", L.close, "×");
  var prev = button("lb-prev", L.prev, "‹");
  var next = button("lb-next", L.next, "›");
  dialog.append(figure, prev, next, close);
  document.body.append(dialog);

  var items = [];
  var index = 0;
  function show(i) {
    index = (i + items.length) % items.length;
    var it = items[index];
    img.src = it.src;
    img.alt = it.alt;
    caption.textContent = it.caption + " · " + (index + 1) + L.of + items.length;
    var single = items.length < 2;
    prev.hidden = single;
    next.hidden = single;
  }

  galleries.forEach(function (gallery) {
    var list = [];
    gallery.querySelectorAll(".shot").forEach(function (shot) {
      var pic = shot.querySelector("img");
      if (!pic) return;
      var cap = shot.querySelector("figcaption");
      var entry = { src: pic.currentSrc || pic.src, alt: pic.alt, caption: cap ? cap.textContent : "" };
      var pos = list.push(entry) - 1;
      var open = button("shot-open", L.open + (entry.caption || entry.alt), "");
      pic.replaceWith(open);
      open.append(pic);
      open.addEventListener("click", function () {
        items = list;
        show(pos);
        dialog.showModal();
        close.focus();
      });
    });
  });

  prev.addEventListener("click", function () { show(index - 1); });
  next.addEventListener("click", function () { show(index + 1); });
  close.addEventListener("click", function () { dialog.close(); });
  // A click beside the image (on the backdrop or the dialog itself) closes it.
  dialog.addEventListener("click", function (e) {
    if (e.target === dialog || e.target === figure) dialog.close();
  });
  dialog.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") { show(index - 1); e.preventDefault(); }
    if (e.key === "ArrowRight") { show(index + 1); e.preventDefault(); }
  });
  var startX = null;
  dialog.addEventListener("touchstart", function (e) { startX = e.touches[0].clientX; }, { passive: true });
  dialog.addEventListener("touchend", function (e) {
    if (startX === null) return;
    var dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
  });
  dialog.addEventListener("close", function () { img.removeAttribute("src"); });
})();

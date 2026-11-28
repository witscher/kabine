// "Copy code" buttons (banner page): copy the text of the element named in data-copy. Without JavaScript
// or the clipboard API the buttons stay hidden and the code can be selected by hand.
(function () {
  if (!navigator.clipboard) return;
  var de = document.documentElement.lang === "de";
  document.querySelectorAll("[data-copy]").forEach(function (button) {
    var source = document.getElementById(button.getAttribute("data-copy"));
    if (!source) return;
    var label = button.textContent;
    button.hidden = false;
    button.addEventListener("click", function () {
      navigator.clipboard.writeText(source.textContent).then(
        function () {
          button.textContent = de ? "Kopiert" : "Copied";
          setTimeout(function () {
            button.textContent = label;
          }, 2000);
        },
        // Copying refused (browser setting): select the code, so it can be copied by hand
        function () {
          var range = document.createRange();
          range.selectNodeContents(source);
          var selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        },
      );
    });
  });
})();

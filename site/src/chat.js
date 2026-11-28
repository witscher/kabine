// Chat bubble of kabine.dev: a small panel at the bottom right that asks site/chat.mjs. Without JavaScript
// nothing appears. Replies are inserted as text; only links to kabine.dev, the demo and Kabine's GitHub
// repository become clickable. The visitor id is created with the first message, kept in localStorage
// ("kabine-chat-id") and removed with "Delete chat". Messages travel only in POST bodies.
(function () {
  "use strict";
  if (!window.fetch || !window.crypto || !crypto.getRandomValues) return;
  var de = document.documentElement.lang === "de";
  var lang = de ? "de" : "en";
  var MAX = 400;
  var KEY = "kabine-chat-id";
  var LINK_HOSTS = ["kabine.dev", "handball.kabine.dev"];
  var T = de
    ? {
        open: "Fragen zu Kabine? Chat öffnen",
        close: "Chat schließen",
        title: "Fragen zu Kabine",
        sub: "Eine KI antwortet aus der Dokumentation.",
        welcome: "Hallo! Ich beantworte Fragen zu Kabine: was die App kann, wie ein Verein sie installiert und betreibt und wie man sie nutzt. Ich kann mich irren; maßgeblich ist die Dokumentation.",
        examples: ["Wie installiert ein Verein Kabine?", "Was kostet der Betrieb?", "Wer sieht die Absagegründe?"],
        label: "Deine Frage",
        placeholder: "Frag etwas zu Kabine …",
        send: "Senden",
        clear: "Chat löschen",
        cleared: "Der Chat ist gelöscht.",
        confirmClear: "Den Chat löschen? Die Nachrichten werden auch auf dem Server gelöscht.",
        typing: "Antwort kommt …",
        offline: "Gerade kann ich nicht antworten. Versuch es später noch einmal.",
        note: "Deine Nachrichten verarbeiten Workers AI und der Server dieser Website bei Cloudflare; gespeichert werden sie bis 24 Stunden nach deiner letzten Nachricht. Bitte gib keine persönlichen Daten ein (Namen, E-Mail-Adressen, Telefonnummern, Anschriften): Nachrichten damit lehnt der Chat ab und speichert sie nicht. ",
        noteShort: "Bitte keine persönlichen Daten eingeben. Gespeichert bis 24 Stunden nach der letzten Nachricht. ",
        privacy: "Datenschutz",
        privacyHref: "/datenschutz/#chat",
        you: "Du",
        bot: "Kabine-Assistent",
        count: function (n) { return n + " / " + MAX; },
        seconds: function (ms) { return (ms / 1000).toLocaleString("de", { maximumFractionDigits: 1 }) + " s"; },
        routes: {
          answer: "Clef → GLM-5.3, aus der Doku",
          personal_data: "persönliche Daten erkannt, nicht gespeichert",
          answer_unsure: "Clef unsicher → GLM-5.3, aus der Doku",
          blocked: "Clef: Manipulationsversuch, feste Antwort",
          off_topic: "Clef: nicht zu Kabine, feste Antwort",
          greeting: "Clef: Begrüßung, feste Antwort",
          thanks: "Clef: Dank, feste Antwort",
          limit: "Limit erreicht, kein Modell",
          budget: "Tageslimit erreicht, kein Modell",
          error: "Fehler, feste Antwort",
          too_long: "zu lang, kein Modell",
        },
        steps: { precheck: "Vorprüfung", triage: "Triage", sections: "Abschnitte", answer: "Antwort" },
      }
    : {
        open: "Questions about Kabine? Open the chat",
        close: "Close the chat",
        title: "Questions about Kabine",
        sub: "An AI answers from the documentation.",
        welcome: "Hi! I answer questions about Kabine: what the app does, how a club installs and runs it, and how to use it. I can be wrong; the documentation is what counts.",
        examples: ["How does a club install Kabine?", "What does running it cost?", "Who sees the reasons for declining?"],
        label: "Your question",
        placeholder: "Ask something about Kabine …",
        send: "Send",
        clear: "Delete chat",
        cleared: "The chat has been deleted.",
        confirmClear: "Delete the chat? The messages are deleted on the server too.",
        typing: "Answer coming …",
        offline: "I can't answer right now. Please try again later.",
        note: "Your messages are processed by Workers AI and this website's server at Cloudflare and kept until 24 hours after your last message. Please don't send personal data (names, e-mail addresses, phone numbers, postal addresses): the chat refuses such messages and does not store them. ",
        noteShort: "Please don't send personal data. Kept until 24 hours after the last message. ",
        privacy: "Privacy",
        privacyHref: "/en/privacy/#chat",
        you: "You",
        bot: "Kabine assistant",
        count: function (n) { return n + " / " + MAX; },
        seconds: function (ms) { return (ms / 1000).toLocaleString("en", { maximumFractionDigits: 1 }) + " s"; },
        routes: {
          answer: "Clef → GLM-5.3, from the docs",
          personal_data: "personal data detected, not stored",
          answer_unsure: "Clef unsure → GLM-5.3, from the docs",
          blocked: "Clef: manipulation attempt, fixed reply",
          off_topic: "Clef: not about Kabine, fixed reply",
          greeting: "Clef: greeting, fixed reply",
          thanks: "Clef: thanks, fixed reply",
          limit: "limit reached, no model",
          budget: "daily limit reached, no model",
          error: "error, fixed reply",
          too_long: "too long, no model",
        },
        steps: { precheck: "pre-check", triage: "triage", sections: "sections", answer: "answer" },
      };

  function storedId() {
    try {
      var id = localStorage.getItem(KEY);
      return id && /^[A-Za-z0-9_-]{22}$/.test(id) ? id : null;
    } catch (e) {
      return null;
    }
  }
  var memoryId = null;
  function visitorId(create) {
    var id = storedId() || memoryId;
    if (id || !create) return id;
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    id = btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    memoryId = id;
    try {
      localStorage.setItem(KEY, id);
    } catch (e) {
      // Without localStorage the chat lasts as long as the page
    }
    return id;
  }
  function forgetId() {
    memoryId = null;
    try {
      localStorage.removeItem(KEY);
    } catch (e) {}
  }

  function post(path, body) {
    body.lang = lang;
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" }).then(function (r) {
      return r.json().catch(function () {
        return {};
      });
    });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /** A link only for https addresses on kabine.dev, the demo or github.com/witscher/kabine. */
  function allowedUrl(raw) {
    try {
      var u = new URL(raw);
      if (u.protocol !== "https:" || u.username || u.password) return null;
      if (LINK_HOSTS.indexOf(u.hostname) >= 0) return u;
      if (u.hostname === "github.com" && /^\/witscher\/kabine(\/|$)/.test(u.pathname)) return u;
    } catch (e) {}
    return null;
  }
  /** Text with the allowed links as <a>, everything else as text nodes. */
  function appendText(parent, text) {
    var re = /https?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/g;
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      var u = allowedUrl(m[0]);
      if (u) {
        var a = el("a", null, m[0]);
        a.href = u.href;
        if (u.hostname === "github.com") a.rel = "noopener";
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(m[0]));
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }
  /** Paragraphs from blank lines, lists from lines starting with "- ". */
  function renderText(parent, text) {
    String(text)
      .split(/\n{2,}/)
      .forEach(function (block) {
        var lines = block.split("\n");
        var list = null;
        var p = null;
        lines.forEach(function (line) {
          if (/^\s*[-•]\s+/.test(line)) {
            if (!list) list = parent.appendChild(el("ul"));
            p = null;
            appendText(list.appendChild(el("li")), line.replace(/^\s*[-•]\s+/, ""));
          } else if (line.trim()) {
            list = null;
            if (p) p.appendChild(el("br"));
            else p = parent.appendChild(el("p"));
            appendText(p, line);
          }
        });
      });
  }

  // Building the panel ---------------------------------------------------------------------------------
  var root = el("div", "kc");
  var bubble = el("button", "kc-bubble");
  bubble.type = "button";
  bubble.setAttribute("aria-label", T.open);
  bubble.setAttribute("aria-expanded", "false");
  bubble.setAttribute("aria-controls", "kc-panel");
  var svgNs = "http://www.w3.org/2000/svg";
  var icon = document.createElementNS(svgNs, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "28");
  icon.setAttribute("height", "28");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  var path = document.createElementNS(svgNs, "path");
  path.setAttribute("d", "M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm4 6.5a1.5 1.5 0 1 0 0 .01zm4 0a1.5 1.5 0 1 0 0 .01zm4 0a1.5 1.5 0 1 0 0 .01z");
  path.setAttribute("fill", "currentColor");
  icon.appendChild(path);
  bubble.appendChild(icon);

  var panel = el("div", "kc-panel");
  panel.id = "kc-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", "kc-title");
  var head = panel.appendChild(el("div", "kc-head"));
  var titles = head.appendChild(el("div", "kc-titles"));
  var title = titles.appendChild(el("h2", "kc-title", T.title));
  title.id = "kc-title";
  titles.appendChild(el("p", "kc-sub", T.sub));
  var clearBtn = head.appendChild(el("button", "kc-clear", T.clear));
  clearBtn.type = "button";
  var closeBtn = head.appendChild(el("button", "kc-close", "×"));
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", T.close);

  var log = panel.appendChild(el("div", "kc-log"));
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-relevant", "additions");
  log.tabIndex = 0;
  var status = panel.appendChild(el("p", "kc-sr"));
  status.setAttribute("role", "status");

  var form = panel.appendChild(el("form", "kc-form"));
  var label = form.appendChild(el("label", "kc-sr", T.label));
  label.htmlFor = "kc-input";
  var input = form.appendChild(el("textarea", "kc-input"));
  input.id = "kc-input";
  input.rows = 2;
  input.maxLength = MAX;
  input.placeholder = T.placeholder;
  input.setAttribute("aria-describedby", "kc-note");
  var row = form.appendChild(el("div", "kc-row"));
  var count = row.appendChild(el("span", "kc-count", T.count(0)));
  count.setAttribute("aria-hidden", "true");
  var sendBtn = row.appendChild(el("button", "kc-send", T.send));
  sendBtn.type = "submit";
  // The full note; on a phone a short one, so the conversation keeps the room above the keyboard
  var note = panel.appendChild(el("p", "kc-note"));
  note.id = "kc-note";
  note.appendChild(el("span", "kc-note-long", T.note));
  note.appendChild(el("span", "kc-note-short", T.noteShort));
  var privacy = note.appendChild(el("a", null, T.privacy));
  privacy.href = T.privacyHref;

  root.appendChild(panel);
  root.appendChild(bubble);

  // Messages -----------------------------------------------------------------------------------------------
  function addMessage(who, text, reply) {
    var item = el("div", "kc-msg kc-" + who);
    item.appendChild(el("span", "kc-sr", (who === "user" ? T.you : T.bot) + ": "));
    var body = item.appendChild(el("div", "kc-text"));
    if (who === "user") body.textContent = text;
    else renderText(body, text);
    if (reply && reply.route && T.routes[reply.route]) {
      var parts = [T.routes[reply.route]];
      var steps = reply.steps || [];
      if (steps.length) {
        parts.push(
          steps
            .map(function (s) {
              return (T.steps[s.step] || s.step) + " " + T.seconds(s.ms);
            })
            .join(" · "),
        );
      }
      item.appendChild(el("p", "kc-meta", parts.join(" · ")));
    }
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
    return item;
  }

  function welcome() {
    addMessage("bot", T.welcome);
    var chips = el("div", "kc-examples");
    T.examples.forEach(function (q) {
      var b = chips.appendChild(el("button", "kc-example", q));
      b.type = "button";
      b.addEventListener("click", function () {
        chips.remove();
        send(q);
      });
    });
    log.appendChild(chips);
  }

  var loaded = false;
  function loadHistory() {
    if (loaded) return;
    loaded = true;
    var id = visitorId(false);
    if (!id) return welcome();
    post("/api/chat/history", { id: id })
      .then(function (r) {
        var turns = (r && r.turns) || [];
        if (!turns.length) return welcome();
        turns.forEach(function (t) {
          addMessage(t.role === "user" ? "user" : "bot", t.text);
        });
      })
      .catch(welcome);
  }

  var pending = false;
  function send(text) {
    text = text.trim();
    if (!text || pending || text.length > MAX) return;
    pending = true;
    sendBtn.disabled = true;
    var examples = log.querySelector(".kc-examples");
    if (examples) examples.remove();
    var mine = addMessage("user", text);
    var typing = el("div", "kc-msg kc-bot kc-typing", T.typing);
    typing.setAttribute("aria-hidden", "true");
    log.appendChild(typing);
    log.scrollTop = log.scrollHeight;
    status.textContent = T.typing;
    post("/api/chat", { id: visitorId(true), message: text })
      .then(function (r) {
        // Refused for personal data: the message is gone from the chat and back in the field for editing
        if (r && r.route === "personal_data") {
          mine.remove();
          if (!input.value) {
            input.value = text;
            count.textContent = T.count(text.length);
          }
        }
        addMessage("bot", r && r.reply ? r.reply : T.offline, r);
      })
      .catch(function () {
        addMessage("bot", T.offline);
      })
      .then(function () {
        typing.remove();
        status.textContent = "";
        pending = false;
        sendBtn.disabled = false;
      });
  }

  // Events -------------------------------------------------------------------------------------------------
  // On a phone the open panel fills the visible part of the screen, above the keyboard (chat.css)
  var vv = window.visualViewport;
  function fitViewport() {
    if (!vv) return;
    root.style.setProperty("--kc-vh", vv.height + "px");
    root.style.setProperty("--kc-top", vv.offsetTop + "px");
    log.scrollTop = log.scrollHeight;
  }
  function open() {
    panel.hidden = false;
    root.classList.add("kc-open");
    document.documentElement.classList.add("kc-lock");
    if (vv) {
      fitViewport();
      vv.addEventListener("resize", fitViewport);
      vv.addEventListener("scroll", fitViewport);
    }
    bubble.setAttribute("aria-expanded", "true");
    loadHistory();
    input.focus();
  }
  function close() {
    panel.hidden = true;
    root.classList.remove("kc-open");
    document.documentElement.classList.remove("kc-lock");
    if (vv) {
      vv.removeEventListener("resize", fitViewport);
      vv.removeEventListener("scroll", fitViewport);
    }
    bubble.setAttribute("aria-expanded", "false");
    bubble.focus();
  }
  bubble.addEventListener("click", function () {
    if (panel.hidden) open();
    else close();
  });
  closeBtn.addEventListener("click", close);
  panel.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value;
    if (!text.trim() || pending) return;
    input.value = "";
    count.textContent = T.count(0);
    send(text);
    input.focus();
  });
  input.addEventListener("keydown", function (e) {
    // Enter sends, Shift+Enter makes a new line
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });
  input.addEventListener("input", function () {
    count.textContent = T.count(input.value.length);
  });
  clearBtn.addEventListener("click", function () {
    if (!window.confirm(T.confirmClear)) return;
    var id = visitorId(false);
    var done = function () {
      forgetId();
      log.textContent = "";
      welcome();
      status.textContent = T.cleared;
      input.focus();
    };
    if (!id) return done();
    post("/api/chat/delete", { id: id }).then(
      function (r) {
        if (r && r.deleted) done();
        else status.textContent = T.offline;
      },
      function () {
        status.textContent = T.offline;
      },
    );
  });

  // The styles first, then the bubble (so it never shows unstyled)
  var css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/chat.css";
  css.addEventListener("load", function () {
    document.body.appendChild(root);
  });
  document.head.appendChild(css);
})();

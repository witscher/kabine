// kabine.dev: static pages from site/dist, plus the contact form (POST /api/contact). The form checks
// Cloudflare Turnstile and sends the message by e-mail to the operator; nothing is stored or logged.
// Deliberately in German and English only, like the website.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAIL_FROM = { email: "noreply@kabine.dev", name: "kabine.dev contact form" };

const MAX_BODY_BYTES = 32 * 1024;
const LIMITS = { name: 100, email: 254, message: 5000 };
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
// Control characters, except tab and newline (allowed in the message only)
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

const PAGES = {
  de: { form: "/kontakt/", sent: "/kontakt/gesendet/" },
  en: { form: "/en/contact/", sent: "/en/contact/sent/" },
};
const ERRORS = {
  de: {
    invalid: "Bitte gib deinen Namen, eine gültige E-Mail-Adresse und eine Nachricht ein.",
    too_large: "Deine Nachricht ist zu lang.",
    turnstile: "Die Spam-Prüfung ist fehlgeschlagen oder abgelaufen. Bitte versuch es noch einmal.",
    unavailable: "Deine Nachricht konnte gerade nicht gesendet werden. Bitte versuch es später noch einmal oder schreib eine E-Mail.",
  },
  en: {
    invalid: "Please fill in your name, a valid email address and a message.",
    too_large: "Your message is too long.",
    turnstile: "The spam check failed or expired. Please try again.",
    unavailable: "Your message could not be sent right now. Please try again later or send an email instead.",
  },
};
// The contact pages load Turnstile, so they get their own policy (see site/src/_headers)
const CONTACT_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/contact") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return handleContact(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleContact(request, env) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY_BYTES) return contactPage(request, env, "de", 413, "too_large");
  let form;
  try {
    form = await request.formData();
  } catch {
    return contactPage(request, env, "de", 400, "invalid");
  }
  const lang = form.get("lang") === "en" ? "en" : "de";
  const fields = {
    name: clean(form.get("name")).replace(/\s+/g, " "),
    email: clean(form.get("email")),
    message: clean(form.get("message"), true),
  };
  if (fields.message.length > LIMITS.message) return contactPage(request, env, lang, 413, "too_large", fields);
  if (
    !fields.name ||
    fields.name.length > LIMITS.name ||
    !fields.email ||
    fields.email.length > LIMITS.email ||
    !EMAIL_RE.test(fields.email) ||
    !fields.message
  ) {
    return contactPage(request, env, lang, 400, "invalid", fields);
  }
  const token = form.get("cf-turnstile-response");
  if (typeof token !== "string" || !token || !(await verifyTurnstile(token, request, env))) {
    return contactPage(request, env, lang, 403, "turnstile", fields);
  }
  try {
    await env.EMAIL.send({
      to: env.MAIL_TO,
      from: MAIL_FROM,
      replyTo: { email: fields.email, name: fields.name },
      subject: `Kabine contact form: ${fields.name}`,
      text: `Name: ${fields.name}\nEmail: ${fields.email}\n\n${fields.message}\n`,
    });
  } catch {
    // Deliberately not logged: the error could carry form contents
    return contactPage(request, env, lang, 502, "unavailable", fields);
  }
  return Response.redirect(new URL(PAGES[lang].sent, request.url), 303);
}

async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET_KEY) return false;
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET_KEY);
  body.append("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.append("remoteip", ip);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body });
    return (await res.json()).success === true;
  } catch {
    return false;
  }
}

function clean(value, multiline = false) {
  if (typeof value !== "string") return "";
  let s = value.replace(/\r\n?/g, "\n").replace(CONTROL_RE, "");
  if (!multiline) s = s.replace(/[\t\n]/g, " ");
  return s.trim();
}

/** The static contact page again, with the error and the visitor's input, so the form also works without JavaScript. */
async function contactPage(request, env, lang, status, error, fields = {}) {
  const page = await env.ASSETS.fetch(new Request(new URL(PAGES[lang].form, request.url)));
  const fill = (value) => ({ element: (el) => value && el.setAttribute("value", value) });
  const rewritten = new HTMLRewriter()
    .on("#form-status", {
      element(el) {
        el.removeAttribute("hidden");
        el.setInnerContent(ERRORS[lang][error]);
      },
    })
    .on("input[name=name]", fill(fields.name))
    .on("input[name=email]", fill(fields.email))
    .on("textarea[name=message]", { element: (el) => fields.message && el.setInnerContent(fields.message) })
    .transform(page);
  return new Response(rewritten.body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": CONTACT_CSP, "X-Frame-Options": "DENY" },
  });
}

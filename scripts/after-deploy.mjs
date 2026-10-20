// Printed at the end of `npm run deploy`, so the build log of a new installation says what comes next.
// Nothing is checked here: the app itself knows whether it still waits for its first admin.
const line = "─".repeat(72);
console.log(`
${line}
Kabine is deployed.

New installation? Two steps, in this order:

  1. Give the app the club's address, before anyone signs in (passkeys are bound to it):
     Cloudflare dashboard → Workers & Pages → this Worker → Settings → Domains & Routes
     → Add → Custom domain, e.g. app.your-club.org

  2. Open that address. The app asks for the setup password you chose when deploying
     (ADMIN_BOOTSTRAP_TOKEN) and sets up the first admin, then the setup wizard starts.

Later, for updates: add the update workflow to your copy on GitHub once
(docs/install.md, step 6 "Updates").

Guide: https://github.com/witscher/kabine/blob/main/docs/install.md
${line}
`);

// Sign-in methods and the setup of a fresh installation. Invented names.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { api, exec, freshDb, loginAs, one, person } from "./helpers";

const TOKEN = "test-bootstrap-token";

describe("sign-in methods", () => {
  beforeEach(freshDb);

  it("offer no e-mail or SMS codes until sending is set up", async () => {
    const res = await api("/auth/methods");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: false, sms: false });
  });

  it("offer e-mail codes once the club's SMTP server is set up", async () => {
    await exec(
      "INSERT INTO app_meta (key, value) VALUES ('mail', ?)",
      JSON.stringify({ mode: "smtp", from: "app@example.org", smtp: { host: "smtp.example.org", port: 465, security: "tls", user: "app", passwordSealed: "sealed" } }),
    );
    expect((await api("/auth/methods")).body.email).toBe(true);
  });
});

describe("setup of a fresh installation", () => {
  beforeEach(freshDb);

  it("is pending until an admin has an access", async () => {
    expect((await api("/auth/methods")).body.setupPending).toBe(env.ADMIN_BOOTSTRAP_TOKEN === TOKEN);
    const admin = await person("Alma", { admin: true });
    await loginAs(admin);
    expect((await api("/auth/methods")).body.setupPending).toBe(false);
  });

  it("asks for the first admin and creates nobody before the passkey exists", async () => {
    const info = await api("/bootstrap/info", { body: { token: TOKEN } });
    expect(info.body).toMatchObject({ needsPerson: true });
    expect((await api("/bootstrap/options", { body: { token: TOKEN } })).status).toBe(400);
    const options = await api("/bootstrap/options", { body: { token: TOKEN, firstName: "Alma", lastName: "Admin", email: "alma@example.org" } });
    expect(options.status).toBe(200);
    expect(options.body.options.user.displayName).toBe("Alma Admin");
    expect(await one<{ n: number }>("SELECT count(*) AS n FROM persons")).toEqual({ n: 0 });
  });

  it("rejects a wrong setup password and says how to set a new one", async () => {
    const res = await api("/bootstrap/info", { body: { token: "wrong-password-1234567" } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("bootstrap_wrong");
    expect(res.body.error.message).toContain("ADMIN_BOOTSTRAP_TOKEN");
  });

  it("ignores spaces, line breaks, backticks and quotes around the setup password", async () => {
    const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
    const post = (stored: string, token: string) =>
      app.fetch(
        new Request("http://localhost:5173/api/bootstrap/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }),
        { ...env, ADMIN_BOOTSTRAP_TOKEN: stored } as Env,
        ctx,
      );
    for (const stored of [`  ${TOKEN}\n`, `\`${TOKEN}\``, `"${TOKEN}"`, `' \`${TOKEN}\` '`]) {
      expect((await post(stored, TOKEN)).status, JSON.stringify(stored)).toBe(200);
      expect((await post(stored, `\`${TOKEN}\``)).status, JSON.stringify(stored)).toBe(200);
      expect((await post(stored, "wrong-password-1234567")).status, JSON.stringify(stored)).toBe(403);
    }
    // Backticks inside the password still count
    expect((await post(`ab\`${TOKEN}`, `ab${TOKEN}`)).status).toBe(403);
  });
});

// Mail settings: Cloudflare Email Sending or the club's own SMTP server, with a test mail.
// Also a step of the setup wizard.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "preact/hooks";
import { api, errorMessage } from "../api";
import { useQuery } from "../store";
import { Button, ErrorBox, Field, Notice, Segmented, Spinner, TextField, toast, TopBar, useDocumentTitle } from "../ui";
import { AdminOnly } from "./admin";

type Mode = "cloudflare" | "smtp" | "off";

interface MailView {
  mode: Mode;
  from: string;
  defaultFrom: string | null;
  cloudflareAvailable: boolean;
  smtp: { host: string; port: number; security: "tls" | "starttls"; user: string; hasPassword: boolean } | null;
}

export function MailSettingsForm({ onSaved }: { onSaved?: () => void }) {
  const { data, error, reload } = useQuery<MailView>("/admin/mail");
  const [mode, setMode] = useState<Mode>("cloudflare");
  const [from, setFrom] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [security, setSecurity] = useState<"tls" | "starttls">("starttls");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setMode(data.mode === "off" && data.cloudflareAvailable ? "cloudflare" : data.mode);
    setFrom(data.from);
    if (data.smtp) {
      setHost(data.smtp.host);
      setPort(String(data.smtp.port));
      setSecurity(data.smtp.security);
      setUser(data.smtp.user);
    }
  }, [data]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;

  const save = async () => {
    setProblem(null);
    try {
      await api.put("/admin/mail", {
        mode,
        from: from.trim(),
        smtp: mode === "smtp" ? { host: host.trim(), port: Number(port), security, user: user.trim(), password } : null,
      });
      setPassword("");
      toast(t`Saved`);
      await reload();
      onSaved?.();
    } catch (err) {
      setProblem(errorMessage(err));
    }
  };

  const test = async () => {
    setProblem(null);
    try {
      const res = await api.post<{ message: string }>("/admin/mail/test", {});
      toast(res.message);
    } catch (err) {
      setProblem(errorMessage(err));
    }
  };

  return (
    <div class="stack">
      <section class="card card-pad stack">
        <Segmented<Mode>
          label={t`How the app sends e-mails`}
          value={mode}
          onChange={setMode}
          options={[
            { value: "cloudflare", label: t`Cloudflare` },
            { value: "smtp", label: t`Own server` },
            { value: "off", label: t`No e-mail` },
          ]}
        />
        {mode === "cloudflare" ? (
          <p class="small muted">
            <Trans>
              Cloudflare Email Sending sends from an address of a domain in your Cloudflare account. Set up the domain under Email in the Cloudflare
              dashboard.
            </Trans>
          </p>
        ) : null}
        {mode === "cloudflare" && !data.cloudflareAvailable ? <Notice kind="warn">{t`This installation has no e-mail binding.`}</Notice> : null}
        {mode === "off" ? (
          <Notice kind="warn">
            <Trans>Without e-mail there is no sign-in by code and no e-mail reminders. Passkeys and personal links still work.</Trans>
          </Notice>
        ) : null}
        {mode !== "off" ? (
          <TextField
            label={t`Sender address`}
            type="email"
            inputMode="email"
            value={from}
            onInput={setFrom}
            placeholder={data.defaultFrom ?? "no-reply@example.org"}
            hint={t`Recipients see this address. Replies to it are not read by the app.`}
          />
        ) : null}
      </section>
      {mode === "smtp" ? (
        <section class="card card-pad stack" aria-label={t`SMTP server`}>
          <TextField label={t`Server`} value={host} onInput={setHost} placeholder="smtp.example.org" />
          <div class="grid-2">
            <TextField label={t`Port`} value={port} onInput={setPort} inputMode="numeric" />
            <Field label={t`Encryption`}>
              {(id) => (
                <select
                  id={id}
                  class="select"
                  value={security}
                  onChange={(e) => {
                    const v = (e.target as HTMLSelectElement).value as "tls" | "starttls";
                    setSecurity(v);
                    setPort(v === "tls" ? "465" : "587");
                  }}
                >
                  <option value="starttls">STARTTLS (587)</option>
                  <option value="tls">TLS (465)</option>
                </select>
              )}
            </Field>
          </div>
          <TextField label={t`User name`} value={user} onInput={setUser} autoComplete="off" />
          <TextField
            label={t`Password`}
            type="password"
            value={password}
            onInput={setPassword}
            autoComplete="new-password"
            hint={data.smtp?.hasPassword ? t`Stored encrypted. Leave empty to keep it.` : t`Stored encrypted.`}
          />
        </section>
      ) : null}
      {problem ? <Notice kind="warn">{problem}</Notice> : null}
      <div class="btn-row">
        <Button variant="primary" onClick={save}>
          <Trans>Save</Trans>
        </Button>
        {data.mode !== "off" ? (
          <Button icon="mail" onClick={test}>
            <Trans>Send test mail</Trans>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function AdminMailPage() {
  useDocumentTitle(t`E-mail`);
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={t`E-mail`} kicker={t`Administration`} back="/verwaltung" />
        <div class="content">
          <MailSettingsForm />
        </div>
      </main>
    </AdminOnly>
  );
}

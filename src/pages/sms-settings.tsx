// SMS module: provider (seven.io), API key and sender name, with a test message to the admin's own number.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "preact/hooks";
import { api, errorMessage } from "../api";
import { useQuery } from "../store";
import { Button, ErrorBox, Notice, Spinner, TextField, toast, TopBar, useDocumentTitle } from "../ui";
import { AdminOnly } from "./admin";

interface SmsView {
  provider: "seven";
  sender: string;
  hasApiKey: boolean;
}

export function SmsSettingsForm() {
  const { data, error, reload } = useQuery<SmsView>("/admin/sms");
  const [sender, setSender] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (data) setSender(data.sender);
  }, [data]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <div class="stack">
      <section class="card card-pad stack">
        <p class="small muted">
          <Trans>
            SMS go through seven.io (a German provider with servers in the EU). Create an account there, top up credit and copy the API key. Each message
            costs a few cents, paid by the club.
          </Trans>
        </p>
        <TextField label={t`Sender name`} value={sender} onInput={setSender} maxLength={11} hint={t`At most 11 letters and digits, e.g. the club's short name.`} />
        <TextField
          label={t`API key`}
          type="password"
          value={apiKey}
          onInput={setApiKey}
          autoComplete="off"
          hint={data.hasApiKey ? t`Stored encrypted. Leave empty to keep it.` : t`Stored encrypted.`}
        />
      </section>
      {problem ? <Notice kind="warn">{problem}</Notice> : null}
      <div class="btn-row">
        <Button
          variant="primary"
          onClick={async () => {
            setProblem(null);
            try {
              await api.put("/admin/sms", { sender: sender.trim(), apiKey: apiKey.trim() || undefined });
              setApiKey("");
              toast(t`Saved`);
              await reload();
            } catch (err) {
              setProblem(errorMessage(err));
            }
          }}
        >
          <Trans>Save</Trans>
        </Button>
        {data.hasApiKey ? (
          <Button
            icon="phone"
            onClick={async () => {
              setProblem(null);
              try {
                await api.post("/admin/sms/test", {});
                toast(t`Test message sent.`);
              } catch (err) {
                setProblem(errorMessage(err));
              }
            }}
          >
            <Trans>Send test message</Trans>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function AdminSmsPage() {
  useDocumentTitle(t`SMS`);
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={t`SMS`} kicker={t`Administration`} back="/verwaltung" />
        <div class="content">
          <SmsSettingsForm />
        </div>
      </main>
    </AdminOnly>
  );
}

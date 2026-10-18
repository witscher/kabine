// What is new for admins (worker/domain/news.ts): release notes after an update and modules the club can
// switch on. A card on the start page until the admin marks it as read; meanwhile a dot on the
// Administration tab and on Administration → Club.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import { api, errorMessage } from "./api";
import { Icon } from "./icons";
import { useSession } from "./session";
import { Button, toast } from "./ui";

export function NewsCard() {
  const { me, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const news = me?.news;
  if (!news) return null;
  const version = news.version;
  return (
    <section class="card card-body motd stack-sm" aria-label={t`What is new`}>
      <div class="row-gap">
        <Icon name="bell" size={22} />
        <h2 class="section-title" style={{ margin: 0, flex: 1 }}>
          {news.entries.length ? <Trans>Kabine updated to {version}</Trans> : <Trans>New in Kabine</Trans>}
        </h2>
      </div>
      {news.entries.map((e) => (
        <ul class="news-items">
          {e.items.map((item) => (
            <li>{item}</li>
          ))}
        </ul>
      ))}
      {news.newModules.length ? (
        <div class="stack-sm">
          <p>
            <strong>{news.newModules.length === 1 ? <Trans>New module you can switch on:</Trans> : <Trans>New modules you can switch on:</Trans>}</strong>
          </p>
          <ul class="news-items">
            {news.newModules.map((m) => (
              <li>
                <strong>{m.label}</strong>
                {m.beta ? <span class="pill pill-muted">{t`Beta`}</span> : null} – {m.description}
              </li>
            ))}
          </ul>
          <a class="ext-link" href="/verwaltung/verein">
            <Icon name="settings" size={16} />
            <Trans>Switch on under Administration → Club</Trans>
          </a>
        </div>
      ) : null}
      <div class="btn-row">
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.post("/me/news-seen", {});
              await refresh();
            } catch (err) {
              toast(errorMessage(err), "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Trans>Mark as read</Trans>
        </Button>
      </div>
    </section>
  );
}

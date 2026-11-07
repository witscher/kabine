// What is new for admins and coaches (worker/domain/news.ts): release notes after an update (coaches: the
// coach notes only) and, for admins, modules the club can switch on. A card on the start page until it is
// marked as read; meanwhile a dot on the Events tab (where the card is) and, for new modules, on
// Administration → Club.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import { api, errorMessage } from "./api";
import { Icon } from "./icons";
import { useSession } from "./session";
import type { CoachNote } from "../shared/changelog";
import { Button, CoachMark, toast } from "./ui";

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
        <>
          {e.items.length ? (
            <ul class="news-items">
              {e.items.map((item) => (
                <li>{item}</li>
              ))}
            </ul>
          ) : null}
          {e.coachItems.length ? (
            <div class="stack-sm">
              <p class="coach-head">
                <CoachMark />
                <strong>
                  <Trans>For coaches</Trans>
                </strong>
              </p>
              {e.coachItems.map((item) => (
                <div class="stack-sm">
                  <p>{item.text}</p>
                  {item.example ? <NewsExample kind={item.example} /> : null}
                </div>
              ))}
            </div>
          ) : null}
        </>
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

/**
 * A sample under a coach note, not clickable: here a coach button next to an ordinary one, on a white inset so
 * the coach button stands out on the card.
 */
function NewsExample({ kind }: { kind: NonNullable<CoachNote["example"]> }) {
  if (kind !== "coach-buttons") return null;
  return (
    <div class="news-example" aria-hidden="true">
      <span class="btn btn-sm">
        <Trans>I'm driving</Trans>
      </span>
      <span class="btn btn-sm btn-coach">
        <CoachMark />
        <Trans>Add driver</Trans>
      </span>
    </div>
  );
}

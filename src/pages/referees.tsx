// KiHaSL/JuHaSL: administration (admins) and redeeming the activation link.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { clubName } from "../club";
import { useEffect, useState } from "preact/hooks";
import { api, errorMessage } from "../api";
import { fullDate, isoToLocalDate, personName } from "../format";
import { Icon } from "../icons";
import { useMe, useSession } from "../session";
import { useQuery } from "../store";
import { Button, confirmDialog, copyText, Empty, ErrorBox, Notice, shareLink, Spinner, toast, TopBar, useDocumentTitle } from "../ui";
import { QrLink } from "./team";

interface RefereeLink {
  id: number;
  createdAt: string;
  expiresAt: string;
  createdBy: string | null;
}

interface Referee {
  personId: number;
  firstName: string;
  lastName: string | null;
  birthYear: number | null;
  teams: string | null;
}

/** Admin → KiHaSL/JuHaSL: create a link, revoke links, people with the role. */
export function AdminRefereesPage() {
  useDocumentTitle("KiHaSL/JuHaSL");
  const me = useMe();
  const links = useQuery<{ links: RefereeLink[] }>(me.isAdmin ? "/admin/referee-links" : null);
  const referees = useQuery<{ referees: Referee[] }>(me.isAdmin ? "/admin/referees" : null);
  const [created, setCreated] = useState<{
    url: string;
    expiresAt: string;
  } | null>(null);
  if (!me.isAdmin) {
    return (
      <main class="page">
        <TopBar title="KiHaSL/JuHaSL" back="/" />
        <div class="content">
          <Notice kind="warn">
            <Trans>This area is for admins only.</Trans>
          </Notice>
        </div>
      </main>
    );
  }
  const createdUntil = created ? fullDate(isoToLocalDate(created.expiresAt)) : "";
  return (
    <main class="page">
      <TopBar title="KiHaSL/JuHaSL" kicker={t`Administration`} back="/verwaltung" />
      <div class="content">
        <p class="muted">
          <Trans>
            KiHaSL/JuHaSL referee the youth home games F to C. Whoever has the role sees all these games in the Helpers tab and signs up there. The link only activates people who
            are already in the app: you open it while signed in and choose yourself or your own child.
          </Trans>
        </p>
        <section class="card card-pad stack-sm" aria-label={t`Link`}>
          <strong>
            <Trans>Activation link</Trans>
          </strong>
          <Button
            icon="link"
            onClick={async () => {
              setCreated(await api.post<{ url: string; expiresAt: string }>("/admin/referee-links"));
              void links.reload();
            }}
          >
            <Trans>Create new link</Trans>
          </Button>
          {created ? (
            <div class="stack-sm">
              <QrLink url={created.url} />
              <div class="url-box">{created.url}</div>
              <div class="btn-row">
                <Button variant="primary" icon="share" onClick={() => shareLink(clubName(), t`Activation as KiHaSL/JuHaSL in the Appball app`, created.url)}>
                  <Trans>Share</Trans>
                </Button>
                <Button icon="copy" onClick={() => copyText(created.url)}>
                  <Trans>Copy</Trans>
                </Button>
              </div>
              <p class="small muted">
                <Trans>Valid until {createdUntil}, can be used several times.</Trans>
              </p>
            </div>
          ) : null}
          {links.data?.links.length ? (
            <ul class="list" aria-label={t`Active links`}>
              {links.data.links.map((l) => {
                const date = fullDate(isoToLocalDate(l.createdAt));
                const until = fullDate(isoToLocalDate(l.expiresAt));
                const by = l.createdBy;
                return (
                  <li class="list-row">
                    <span class="main">
                      <span class="title">
                        <Trans>Link from {date}</Trans>
                      </span>
                      <span class="sub">{by ? t`by ${by} · valid until ${until}` : t`valid until ${until}`}</span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (
                          !(await confirmDialog({
                            title: t`Revoke link?`,
                            message: t`After that it can no longer be redeemed.`,
                            confirmLabel: t`Revoke link`,
                            danger: true,
                          }))
                        )
                          return;
                        await api.del(`/admin/referee-links/${l.id}`);
                        void links.reload();
                      }}
                    >
                      <Trans>Revoke link</Trans>
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        <section class="stack-sm" aria-label={t`People with the role`}>
          <h2 class="section-title">
            <Trans>Activated</Trans>
          </h2>
          {referees.error ? <ErrorBox error={referees.error} onRetry={referees.reload} /> : null}
          {!referees.data && !referees.error ? <Spinner /> : null}
          {referees.data && !referees.data.referees.length ? (
            <Empty title={t`No one yet`} icon="whistle">
              <Trans>The role can be given via the link or under Admin → People.</Trans>
            </Empty>
          ) : null}
          <ul class="list">
            {(referees.data?.referees ?? []).map((r) => {
              const year = r.birthYear;
              return (
                <li class="list-row">
                  <Icon name="whistle" size={20} />
                  <span class="main">
                    <span class="title">{personName(r)}</span>
                    <span class="sub">{[r.teams, year ? t`Year of birth ${year}` : null].filter(Boolean).join(" · ") || t`No team`}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api.del(`/admin/referees/${r.personId}`);
                      const name = r.firstName;
                      toast(t`${name} is no longer KiHaSL/JuHaSL.`);
                      void referees.reload();
                    }}
                  >
                    <Trans>Remove</Trans>
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}

interface LinkInfo {
  expiresAt: string;
  loggedIn: boolean;
  candidates: {
    personId: number;
    name: string;
    self: boolean;
    already: boolean;
  }[];
}

/** /kihasl#token: activate while signed in, for oneself or one's own child. */
export function RefereeJoinPage() {
  useDocumentTitle("KiHaSL/JuHaSL");
  const { refresh } = useSession();
  const token = location.hash.slice(1);
  const [data, setData] = useState<LinkInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // The token is in the hash and only goes to the server by POST
  useEffect(() => {
    if (!token) return;
    api
      .post<LinkInfo>("/referee/info", { token })
      .then((d) => {
        setData(d);
        setSelected(d.candidates.find((c) => !c.already)?.personId ?? null);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [token]);
  const name = done;
  return (
    <main class="page">
      <TopBar title="KiHaSL/JuHaSL" kicker={t`Activation`} />
      <div class="content">
        {!token ? (
          <Notice kind="warn">
            <Trans>This link is incomplete.</Trans>
          </Notice>
        ) : null}
        {error ? <Notice kind="warn">{error}</Notice> : null}
        {!data && !error && token ? <Spinner /> : null}
        {done ? (
          <section class="card card-pad stack-sm">
            <strong>
              <Trans>Activated</Trans>
            </strong>
            <p>
              <Trans>{name} is now KiHaSL/JuHaSL. The Helpers tab lists all youth home games that need a referee.</Trans>
            </p>
            <a class="btn btn-primary" href="/helfer?kihasl">
              <Trans>Go to the games</Trans>
            </a>
          </section>
        ) : data ? (
          <section class="card card-pad stack-sm">
            <p>
              <Trans>With this link you (or your child) are activated as KiHaSL/JuHaSL and can then sign up for the youth home games F to C.</Trans>
            </p>
            <div role="radiogroup" aria-label={t`Who referees?`} class="stack-sm">
              {data.candidates.map((c) => {
                const candidate = c.name;
                return (
                  <label class="list-row">
                    <input type="radio" name="referee" checked={selected === c.personId} disabled={c.already} onChange={() => setSelected(c.personId)} />
                    <span class="main">
                      <span class="title">{c.self ? t`${candidate} (me)` : c.name}</span>
                      {c.already ? (
                        <span class="sub">
                          <Trans>already activated</Trans>
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
            <Button
              variant="primary"
              disabled={selected == null}
              onClick={async () => {
                try {
                  await api.post("/referee/accept", {
                    token,
                    personId: selected,
                  });
                  await refresh();
                  setDone(data.candidates.find((c) => c.personId === selected)?.name ?? "");
                } catch (err) {
                  toast(errorMessage(err), "error");
                }
              }}
            >
              {t({ message: "Activate", context: "referee" })}
            </Button>
          </section>
        ) : null}
      </div>
    </main>
  );
}

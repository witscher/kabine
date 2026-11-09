// Approvals for duties that need prior knowledge approved by an admin (e.g. youth referee, tournament management):
// the admin page with links and approved people, and redeeming a link (docs/dev/design.md, Qualifications).
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "preact/hooks";
import { api, errorMessage } from "../../../src/api";
import { clubName } from "../../../src/club";
import { fullDate, isoToLocalDate, personName } from "../../../src/format";
import { Icon } from "../../../src/icons";
import { QrLink } from "../../../src/pages/team";
import { useMe, useSession } from "../../../src/session";
import { invalidate, useQuery } from "../../../src/store";
import { Button, confirmDialog, copyText, Empty, ErrorBox, Notice, shareLink, Spinner, toast, TopBar, useDocumentTitle } from "../../../src/ui";

interface GrantLink {
  id: number;
  dutyTypeId: number;
  createdAt: string;
  expiresAt: string;
  createdBy: string | null;
}

interface Qualification {
  dutyTypeId: number;
  name: string;
  whoQualified: boolean;
  people: { personId: number; firstName: string; lastName: string | null; birthYear: number | null; teams: string | null }[];
}

/** Administration → Approvals: per duty type approved by admins a link and the approved people. */
export function AdminApprovalsPage() {
  useDocumentTitle(t`Approvals`);
  const me = useMe();
  const data = useQuery<{ types: Qualification[] }>(me.isAdmin ? "/admin/qualifications" : null);
  const links = useQuery<{ links: GrantLink[] }>(me.isAdmin ? "/admin/skill-links" : null);
  if (!me.isAdmin) {
    return (
      <main class="page">
        <TopBar title={t`Approvals`} back="/" />
        <div class="content">
          <Notice kind="warn">
            <Trans>This area is for admins only.</Trans>
          </Notice>
        </div>
      </main>
    );
  }
  return (
    <main class="page">
      <TopBar title={t`Approvals`} kicker={t`Administration`} back="/verwaltung" />
      <div class="content">
        <p class="muted">
          <Trans>
            Some duties may only be taken by people an admin approved, for example youth referees. Approve people here with a link or under Admin → People. The link
            only approves people who are already in the app: they open it while signed in and choose themselves or their own child.
          </Trans>
        </p>
        {data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : null}
        {!data.data && !data.error ? <Spinner /> : null}
        {data.data && !data.data.types.length ? (
          <Empty title={t`No duty needs an approval`} icon="whistle">
            <Trans>Under Admin → Helper duties, a duty type with prior knowledge can be approved by an admin instead of by the person.</Trans>
          </Empty>
        ) : null}
        {(data.data?.types ?? []).map((q) => (
          <QualificationCard key={q.dutyTypeId} q={q} links={(links.data?.links ?? []).filter((l) => l.dutyTypeId === q.dutyTypeId)} onChanged={() => void (data.reload(), links.reload())} />
        ))}
      </div>
    </main>
  );
}

function QualificationCard({ q, links, onChanged }: { q: Qualification; links: GrantLink[]; onChanged: () => void }) {
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const createdUntil = created ? fullDate(isoToLocalDate(created.expiresAt)) : "";
  const duty = q.name;
  return (
    <section class="card card-pad stack-sm" aria-label={q.name}>
      <h2 class="section-title" style={{ margin: 0 }}>
        {q.name}
      </h2>
      <Button
        icon="link"
        onClick={async () => {
          setCreated(await api.post<{ url: string; expiresAt: string }>("/admin/skill-links", { dutyTypeId: q.dutyTypeId }));
          onChanged();
        }}
      >
        <Trans>Create new link</Trans>
      </Button>
      {created ? (
        <div class="stack-sm">
          <QrLink url={created.url} />
          <div class="url-box">{created.url}</div>
          <div class="btn-row">
            <Button
              variant="primary"
              icon="share"
              onClick={() => {
                const club = clubName();
                void shareLink(club, t`Approval for ${duty} in the ${club} app`, created.url);
              }}
            >
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
      {links.length ? (
        <ul class="list" aria-label={t`Active links`}>
          {links.map((l) => {
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
                    const ok = await confirmDialog({ title: t`Revoke link?`, message: t`After that it can no longer be redeemed.`, confirmLabel: t`Revoke link`, danger: true });
                    if (!ok) return;
                    await api.del(`/admin/skill-links/${l.id}`);
                    onChanged();
                  }}
                >
                  <Trans>Revoke link</Trans>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <strong>
        <Trans>Approved</Trans> · {q.people.length}
      </strong>
      {!q.people.length ? (
        <p class="small muted">
          <Trans>No one yet. Approve people with the link or under Admin → People.</Trans>
        </p>
      ) : null}
      <ul class="list" aria-label={t`Approved for ${duty}`}>
        {q.people.map((p) => {
          const year = p.birthYear;
          return (
            <li class="list-row">
              <Icon name="whistle" size={20} />
              <span class="main">
                <span class="title">{personName(p)}</span>
                <span class="sub">{[p.teams, year ? t`Year of birth ${year}` : null].filter(Boolean).join(" · ") || t`No team`}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await api.del(`/admin/skill-grants/${p.personId}/${q.dutyTypeId}`);
                  const name = p.firstName;
                  toast(t`${name} is no longer approved for ${duty}.`);
                  invalidate("/admin/persons");
                  onChanged();
                }}
              >
                <Trans>Remove</Trans>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface LinkInfo {
  dutyTypeId: number;
  dutyType: string;
  expiresAt: string;
  loggedIn: boolean;
  candidates: { personId: number; name: string; self: boolean; already: boolean }[];
}

/** /freigabe#token (formerly /kihasl#token): approval while signed in, for oneself or one's own child. */
export function ApprovalJoinPage() {
  useDocumentTitle(t`Approval`);
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
      .post<LinkInfo>("/skill-link/info", { token })
      .then((d) => {
        setData(d);
        setSelected(d.candidates.find((c) => !c.already)?.personId ?? null);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [token]);
  const name = done;
  const duty = data?.dutyType ?? "";
  return (
    <main class="page">
      <TopBar title={duty || t`Approval`} kicker={t`Approval`} />
      <div class="content">
        {!token ? (
          <Notice kind="warn">
            <Trans>This link is incomplete.</Trans>
          </Notice>
        ) : null}
        {error ? <Notice kind="warn">{error}</Notice> : null}
        {!data && !error && token ? <Spinner /> : null}
        {data && !data.loggedIn ? (
          <Notice kind="warn">
            <Trans>Sign in first, then open the link again.</Trans>
          </Notice>
        ) : null}
        {done ? (
          <section class="card card-pad stack-sm">
            <strong>
              <Trans>Approved</Trans>
            </strong>
            <p>
              <Trans>{name} is now approved for {duty}. The Helpers tab lists where help is needed.</Trans>
            </p>
            <a class="btn btn-primary" href={`/helfer?liste=${data?.dutyTypeId ?? ""}`}>
              <Trans>Go to the Helpers tab</Trans>
            </a>
          </section>
        ) : data?.loggedIn ? (
          <section class="card card-pad stack-sm">
            <p>
              <Trans>With this link you (or your child) are approved for {duty} and can then sign up for it.</Trans>
            </p>
            <div role="radiogroup" aria-label={t`Who is approved?`} class="stack-sm">
              {data.candidates.map((c) => {
                const candidate = c.name;
                return (
                  <label class="list-row">
                    <input type="radio" name="approval" checked={selected === c.personId} disabled={c.already} onChange={() => setSelected(c.personId)} />
                    <span class="main">
                      <span class="title">{c.self ? t`${candidate} (me)` : c.name}</span>
                      {c.already ? (
                        <span class="sub">
                          <Trans>already approved</Trans>
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
                  await api.post("/skill-link/accept", { token, personId: selected });
                  await refresh();
                  setDone(data.candidates.find((c) => c.personId === selected)?.name ?? "");
                } catch (err) {
                  toast(errorMessage(err), "error");
                }
              }}
            >
              <Trans>Approve</Trans>
            </Button>
          </section>
        ) : null}
      </div>
    </main>
  );
}

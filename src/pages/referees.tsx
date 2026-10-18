// KiHaSL/JuHaSL: Verwaltung (Admins) und Einlösen des Freischalt-Links.
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

/** Verwaltung → KiHaSL/JuHaSL: Link erzeugen, Links widerrufen, Personen mit Rolle. */
export function AdminRefereesPage() {
  useDocumentTitle("KiHaSL/JuHaSL");
  const me = useMe();
  const links = useQuery<{ links: RefereeLink[] }>(me.isAdmin ? "/admin/referee-links" : null);
  const referees = useQuery<{ referees: Referee[] }>(me.isAdmin ? "/admin/referees" : null);
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  if (!me.isAdmin) {
    return (
      <main class="page">
        <TopBar title="KiHaSL/JuHaSL" back="/" />
        <div class="content">
          <Notice kind="warn">Dieser Bereich ist nur für Admins.</Notice>
        </div>
      </main>
    );
  }
  return (
    <main class="page">
      <TopBar title="KiHaSL/JuHaSL" kicker="Verwaltung" back="/verwaltung" />
      <div class="content">
        <p class="muted">
          KiHaSL/JuHaSL pfeifen die Jugend-Heimspiele F bis C. Wer die Rolle hat, sieht im Reiter Helfer alle diese Spiele und trägt sich dort ein. Der Link
          schaltet nur Personen frei, die schon in der App sind: Man öffnet ihn angemeldet und wählt sich selbst oder ein eigenes Kind.
        </p>
        <section class="card card-pad stack-sm" aria-label="Link">
          <strong>Freischalt-Link</strong>
          <Button
            icon="link"
            onClick={async () => {
              setCreated(await api.post<{ url: string; expiresAt: string }>("/admin/referee-links"));
              void links.reload();
            }}
          >
            Neuen Link erzeugen
          </Button>
          {created ? (
            <div class="stack-sm">
              <QrLink url={created.url} />
              <div class="url-box">{created.url}</div>
              <div class="btn-row">
                <Button variant="primary" icon="share" onClick={() => shareLink(clubName(), "Freischaltung als KiHaSL/JuHaSL in der Appball App", created.url)}>
                  Teilen
                </Button>
                <Button icon="copy" onClick={() => copyText(created.url)}>
                  Kopieren
                </Button>
              </div>
              <p class="small muted">Gültig bis {fullDate(isoToLocalDate(created.expiresAt))}, mehrfach verwendbar.</p>
            </div>
          ) : null}
          {links.data?.links.length ? (
            <ul class="list" aria-label="Aktive Links">
              {links.data.links.map((l) => (
                <li class="list-row">
                  <span class="main">
                    <span class="title">Link vom {fullDate(isoToLocalDate(l.createdAt))}</span>
                    <span class="sub">
                      {l.createdBy ? `von ${l.createdBy} · ` : ""}gültig bis {fullDate(isoToLocalDate(l.expiresAt))}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!(await confirmDialog({ title: "Link zurückziehen?", message: "Danach lässt er sich nicht mehr einlösen.", confirmLabel: "Zurückziehen", danger: true }))) return;
                      await api.del(`/admin/referee-links/${l.id}`);
                      void links.reload();
                    }}
                  >
                    Zurückziehen
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section class="stack-sm" aria-label="Personen mit Rolle">
          <h2 class="section-title">Freigeschaltet</h2>
          {referees.error ? <ErrorBox error={referees.error} onRetry={referees.reload} /> : null}
          {!referees.data && !referees.error ? <Spinner /> : null}
          {referees.data && !referees.data.referees.length ? (
            <Empty title="Noch niemand" icon="whistle">
              Über den Link oder unter Verwaltung → Personen lässt sich die Rolle vergeben.
            </Empty>
          ) : null}
          <ul class="list">
            {(referees.data?.referees ?? []).map((r) => (
              <li class="list-row">
                <Icon name="whistle" size={20} />
                <span class="main">
                  <span class="title">{personName(r)}</span>
                  <span class="sub">{[r.teams, r.birthYear ? `Jahrgang ${r.birthYear}` : null].filter(Boolean).join(" · ") || "Keine Mannschaft"}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api.del(`/admin/referees/${r.personId}`);
                    toast(`${r.firstName} ist kein KiHaSL/JuHaSL mehr.`);
                    void referees.reload();
                  }}
                >
                  Entfernen
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

interface LinkInfo {
  expiresAt: string;
  loggedIn: boolean;
  candidates: { personId: number; name: string; self: boolean; already: boolean }[];
}

/** /kihasl#token: angemeldet freischalten, für sich selbst oder ein eigenes Kind. */
export function RefereeJoinPage() {
  useDocumentTitle("KiHaSL/JuHaSL");
  const { refresh } = useSession();
  const token = location.hash.slice(1);
  const [data, setData] = useState<LinkInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // Der Token steht im Hash und geht nur per POST an den Server
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
  return (
    <main class="page">
      <TopBar title="KiHaSL/JuHaSL" kicker="Freischaltung" />
      <div class="content">
        {!token ? <Notice kind="warn">Dieser Link ist unvollständig.</Notice> : null}
        {error ? <Notice kind="warn">{error}</Notice> : null}
        {!data && !error && token ? <Spinner /> : null}
        {done ? (
          <section class="card card-pad stack-sm">
            <strong>Freigeschaltet</strong>
            <p>{done} ist jetzt KiHaSL/JuHaSL. Im Reiter Helfer stehen alle Jugend-Heimspiele, bei denen ein Schiedsrichter gebraucht wird.</p>
            <a class="btn btn-primary" href="/helfer?kihasl">
              Zu den Spielen
            </a>
          </section>
        ) : data ? (
          <section class="card card-pad stack-sm">
            <p>Mit diesem Link wirst du (oder dein Kind) als KiHaSL/JuHaSL freigeschaltet und kannst dich dann bei den Jugend-Heimspielen F bis C eintragen.</p>
            <div role="radiogroup" aria-label="Wer pfeift?" class="stack-sm">
              {data.candidates.map((c) => (
                <label class="list-row">
                  <input type="radio" name="referee" checked={selected === c.personId} disabled={c.already} onChange={() => setSelected(c.personId)} />
                  <span class="main">
                    <span class="title">{c.self ? `${c.name} (ich)` : c.name}</span>
                    {c.already ? <span class="sub">schon freigeschaltet</span> : null}
                  </span>
                </label>
              ))}
            </div>
            <Button
              variant="primary"
              disabled={selected == null}
              onClick={async () => {
                try {
                  await api.post("/referee/accept", { token, personId: selected });
                  await refresh();
                  setDone(data.candidates.find((c) => c.personId === selected)?.name ?? "");
                } catch (err) {
                  toast(errorMessage(err), "error");
                }
              }}
            >
              Freischalten
            </Button>
          </section>
        ) : null}
      </div>
    </main>
  );
}

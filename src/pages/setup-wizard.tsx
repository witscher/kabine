// Setup wizard: leads the first admin through language, club, sport and season, modules, e-mail,
// first teams and privacy. Opens after the installation and can be reopened under administration.
// Every step saves through the normal administration routes, so nothing is lost when leaving early.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useLocation } from "preact-iso";
import { useEffect, useState } from "preact/hooks";
import { seasonAround, SPORTS, type SportId, type TeamGender } from "../../shared/sports";
import { api, errorMessage } from "../api";
import { clubName, loadClub, useClub } from "../club";
import { fullDate, isoToLocalDate, personName, todayLocal } from "../format";
import { currentLocale } from "../i18n";
import { LanguageSwitch } from "../language-switch";
import { hasListImportDraft, ListImport } from "../list-import";
import { RestoreFromExport } from "../restore";
import { Icon } from "../icons";
import { useSession } from "../session";
import { invalidate, refreshVisible, useQuery } from "../store";
import { Button, copyText, ErrorBox, Field, Notice, shareLink, Spinner, SwitchRow, TextField, toast, TopBar, useDocumentTitle } from "../ui";
import { AdminOnly } from "./admin";
import { ClubProfileForm } from "./club-settings";
import { MailSettingsForm } from "./mail-settings";
import { QrLink } from "./team";

/** Remembers for this browser session that the admin postponed the wizard. */
export const SETUP_LATER_KEY = "kabine.setup.later";

interface SetupStatus {
  setupDone: boolean;
  sport: SportId;
  season: { name: string; startsOn: string; endsOn: string } | null;
  proposedSeason: { name: string; startsOn: string; endsOn: string };
  ageClasses: number;
  teams: number;
  mailMode: "cloudflare" | "smtp" | "off";
}

type StepId = "language" | "club" | "sport" | "modules" | "mail" | "teams" | "people" | "privacy" | "done";
const STEPS: StepId[] = ["language", "club", "sport", "modules", "mail", "teams", "people", "privacy", "done"];

function stepTitle(step: StepId): string {
  switch (step) {
    case "language":
      return t`Language and region`;
    case "club":
      return t`Your club`;
    case "sport":
      return t`Sport and season`;
    case "modules":
      return t`Functions`;
    case "mail":
      return t`E-mail`;
    case "teams":
      return t`First teams`;
    case "people":
      return t`First people`;
    case "privacy":
      return t`Privacy`;
    case "done":
      return t`Ready`;
  }
}

export function SetupWizardPage() {
  useDocumentTitle(t`Setup`);
  const { route } = useLocation();
  const [index, setIndex] = useState(() => {
    const saved = Number(sessionStorageGet("kabine.setup.step"));
    // Opened again after the last step ("The app is set up"): from the start
    return Number.isInteger(saved) && saved > 0 && saved < STEPS.length - 1 ? saved : 0;
  });
  const step = STEPS[index]!;
  const go = (i: number) => {
    setIndex(i);
    sessionStorageSet("kabine.setup.step", String(i));
    window.scrollTo(0, 0);
  };
  const next = () => go(Math.min(index + 1, STEPS.length - 1));
  const later = () => {
    sessionStorageSet(SETUP_LATER_KEY, "1");
    route("/verwaltung");
  };
  const number = index + 1;
  const total = STEPS.length;

  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={stepTitle(step)} kicker={t`Setup · step ${number} of ${total}`} back={index > 0 ? () => go(index - 1) : "/verwaltung"} />
        <div class="content">
          <div class="wizard-progress" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={number} aria-label={t`Progress`}>
            <span style={{ width: `${(number / total) * 100}%` }} />
          </div>
          {step === "language" ? <LanguageStep onNext={next} /> : null}
          {step === "club" ? (
            <>
              <p class="muted">
                <Trans>Name, colours and logo appear on the home screen, in notifications and in e-mails.</Trans>
              </p>
              <ClubProfileForm parts={["name", "look"]} submitLabel={t`Save and continue`} onSaved={next} />
            </>
          ) : null}
          {step === "sport" ? <SportStep onNext={next} /> : null}
          {step === "modules" ? (
            <>
              <p class="muted">
                <Trans>Switch on what your club needs. You can change this at any time under administration → club.</Trans>
              </p>
              <ClubProfileForm parts={["modules"]} submitLabel={t`Save and continue`} onSaved={next} />
            </>
          ) : null}
          {step === "mail" ? <MailStep onNext={next} /> : null}
          {step === "teams" ? <TeamsStep onNext={next} /> : null}
          {step === "people" ? <PeopleStep onNext={next} /> : null}
          {step === "privacy" ? <PrivacyStep onNext={next} /> : null}
          {step === "done" ? <DoneStep onRestart={() => go(0)} /> : null}
          {step !== "done" ? (
            <Button variant="ghost" block onClick={later}>
              <Trans>Continue later</Trans>
            </Button>
          ) : null}
        </div>
      </main>
    </AdminOnly>
  );
}

function LanguageStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <p class="muted">
        <Trans>Welcome! A few steps and your club can start. Everything can be changed later under administration.</Trans>
      </p>
      <section class="card card-pad stack" aria-label={t`Your language`}>
        <h2 class="section-title" style={{ margin: 0 }}>
          <Trans>Your language</Trans>
        </h2>
        <LanguageSwitch />
      </section>
      <p class="muted">
        <Trans>The club's language applies to everyone who has not chosen one, and to e-mails. The region decides school holidays and public holidays.</Trans>
      </p>
      <ClubProfileForm parts={["region"]} submitLabel={t`Save and continue`} onSaved={onNext} />
    </>
  );
}

function SportStep({ onNext }: { onNext: () => void }) {
  const { data, error, reload } = useQuery<SetupStatus>("/admin/setup");
  const [sport, setSport] = useState<SportId>("handball");
  const [season, setSeason] = useState<{ name: string; startsOn: string; endsOn: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locale = currentLocale();

  useEffect(() => {
    if (!data) return;
    setSport(data.sport);
    if (!data.season) setSeason(data.proposedSeason);
  }, [data]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;

  const chooseSport = (id: SportId) => {
    setSport(id);
    if (!data.season) setSeason(seasonAround(todayLocal(), SPORTS[id].seasonStart));
  };
  const save = async () => {
    setProblem(null);
    setBusy(true);
    try {
      await api.post("/admin/setup/sport", { sport, ...(season && !data.season ? { season } : {}) });
      invalidate("/admin/setup");
      invalidate("/age-classes");
      await loadClub();
      onNext();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const seasonName = data.season?.name ?? "";
  const seasonFrom = data.season ? fullDate(data.season.startsOn) : "";
  const seasonTo = data.season ? fullDate(data.season.endsOn) : "";

  return (
    <>
      <p class="muted">
        <Trans>The sport brings suitable age groups, playing times and helper duties. You adjust them later under administration.</Trans>
      </p>
      <section class="card card-pad stack" aria-label={t`Sport`}>
        <Field label={t`Sport`}>
          {(id) => (
            <select id={id} class="select" value={sport} onChange={(e) => chooseSport((e.target as HTMLSelectElement).value as SportId)}>
              {(Object.keys(SPORTS) as SportId[]).map((s) => (
                <option value={s}>{s === "other" ? t`Other sport` : SPORTS[s].name[locale]}</option>
              ))}
            </select>
          )}
        </Field>
        {data.ageClasses ? (
          <p class="small muted">
            <Trans>The season already has age groups. They stay as they are.</Trans>
          </p>
        ) : null}
      </section>
      <section class="card card-pad stack" aria-label={t`Season`}>
        {data.season ? (
          <p>
            <Trans>
              Current season: <strong>{seasonName}</strong>, {seasonFrom} to {seasonTo}
            </Trans>
          </p>
        ) : season ? (
          <>
            <TextField label={t`Name of the season`} value={season.name} onInput={(v) => setSeason({ ...season, name: v })} maxLength={20} />
            <div class="club-colors">
              <Field label={t`First day`}>
                {(id) => <input id={id} type="date" class="input" value={season.startsOn} onInput={(e) => setSeason({ ...season, startsOn: (e.target as HTMLInputElement).value })} />}
              </Field>
              <Field label={t`Last day`}>
                {(id) => <input id={id} type="date" class="input" value={season.endsOn} onInput={(e) => setSeason({ ...season, endsOn: (e.target as HTMLInputElement).value })} />}
              </Field>
            </div>
            <p class="small muted">
              <Trans>Trainings are created up to the end of the season. The season change at the end prepares the next one.</Trans>
            </p>
          </>
        ) : null}
      </section>
      {problem ? <Notice kind="warn">{problem}</Notice> : null}
      <Button variant="primary" block disabled={busy} onClick={save}>
        <Trans>Save and continue</Trans>
      </Button>
    </>
  );
}

function MailStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <p class="muted">
        <Trans>
          The app sends e-mails for sign-in codes, access links and helper plan reminders. Without e-mail, people sign in with passkeys and links you hand out.
        </Trans>
      </p>
      <MailSettingsForm onSaved={onNext} />
      <Button block onClick={onNext}>
        <Trans>Skip</Trans>
      </Button>
    </>
  );
}

interface TeamRow {
  id: number;
  name: string;
  kind: "team" | "group";
  ageClassCode: string;
}

/**
 * Teams by hand, or teams, coaches and players from the club's lists in one go (src/list-import.tsx). The choice
 * comes first, before anyone is created, so that an import does not meet half a set of hand-made entries.
 */
function TeamsStep({ onNext }: { onNext: () => void }) {
  const { refresh } = useSession();
  const teams = useQuery<{ teams: TeamRow[] }>("/teams");
  const ages = useQuery<{ ageClasses: { code: string; name: string; birthYearMin?: number | null; birthYearMax?: number | null }[] }>("/age-classes");
  const [mode, setMode] = useState<"choose" | "manual" | "import" | "restore">(() => (hasListImportDraft() ? "import" : "choose"));
  const [name, setName] = useState("");
  const [ageClassCode, setAgeClassCode] = useState("");
  const [gender, setGender] = useState<TeamGender>("x");
  const [problem, setProblem] = useState<string | null>(null);
  const classes = ages.data?.ageClasses ?? [];
  const list = (teams.data?.teams ?? []).filter((x) => x.kind === "team");

  useEffect(() => {
    if (!ageClassCode && classes[0]) setAgeClassCode(classes[0].code);
  }, [classes.length]);

  const add = async () => {
    setProblem(null);
    try {
      await api.post("/teams", { name: name.trim(), ageClassCode, gender, level: 1 });
      setName("");
      toast(t`Team created`);
      // The new team is also a chat room
      invalidate("/teams", "/chat");
      await refresh();
    } catch (err) {
      setProblem(errorMessage(err));
    }
  };

  if (mode === "import" && ages.data && teams.data) {
    return (
      <ListImport
        inSetup
        ageClasses={classes.map((a) => ({ code: a.code, name: a.name, birthYearMin: a.birthYearMin ?? null, birthYearMax: a.birthYearMax ?? null }))}
        existingTeams={(teams.data.teams ?? []).map((x) => x.name)}
        onCancel={() => setMode("manual")}
        onDone={async () => {
          // Many teams and people at once: own memberships, chat rooms, events … everything loaded so far is old
          await refresh();
          await refreshVisible();
          onNext();
        }}
      />
    );
  }
  if (mode === "choose" && teams.data && !list.length) {
    return (
      <>
        <p class="muted">
          <Trans>Does your club have lists of its teams, coaches and players, for example in Excel? Then they can be imported in one go.</Trans>
        </p>
        <section class="card card-pad stack-sm" aria-label={t`From lists`}>
          <h2 class="section-title" style={{ margin: 0 }}>
            <Trans>Import from lists</Trans>
          </h2>
          <p class="small muted">
            <Trans>
              Excel or CSV files, also several with overlapping people. Teams, coaches and players are created after you have checked and corrected them.
            </Trans>
          </p>
          <Button variant="primary" icon="download" onClick={() => setMode("import")}>
            <Trans>Import lists</Trans>
          </Button>
        </section>
        <section class="card card-pad stack-sm" aria-label={t`By hand`}>
          <h2 class="section-title" style={{ margin: 0 }}>
            <Trans>Enter by hand</Trans>
          </h2>
          <p class="small muted">
            <Trans>Create the teams and coaches here; players come later through the coaches' invitation links or their player lists.</Trans>
          </p>
          <Button onClick={() => setMode("manual")}>
            <Trans>Enter by hand</Trans>
          </Button>
        </section>
        <section class="card card-pad stack-sm" aria-label={t`From an export of Kabine`}>
          <h2 class="section-title" style={{ margin: 0 }}>
            <Trans>From an export of Kabine</Trans>
          </h2>
          <p class="small muted">
            <Trans>Moving from another installation: take over teams, people, events and chats from its export file.</Trans>
          </p>
          <Button onClick={() => setMode("restore")}>
            <Trans>Choose export file</Trans>
          </Button>
        </section>
      </>
    );
  }
  if (mode === "restore") {
    return (
      <RestoreFromExport
        cancelLabel={t`Back`}
        onCancel={() => setMode("choose")}
        onDone={async () => {
          await refresh();
          await loadClub();
          await refreshVisible();
          onNext();
        }}
      />
    );
  }

  return (
    <>
      <p class="muted">
        <Trans>Create the teams that start now. Coaches, players and training plans follow in each team; more teams can be added later.</Trans>
      </p>
      {teams.error ? <ErrorBox error={teams.error} onRetry={teams.reload} /> : null}
      {list.length ? (
        <ul class="list" aria-label={t`Teams`}>
          {list.map((team) => (
            <li>
              <div class="list-row">
                <span class="team-badge" style={{ minWidth: "48px", textAlign: "center" }}>
                  {team.name}
                </span>
                <span class="main">
                  <span class="sub">{classes.find((a) => a.code === team.ageClassCode)?.name ?? team.ageClassCode}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <section class="card card-pad stack" aria-label={t`New team`}>
        <TextField label={t`Name`} value={name} onInput={setName} maxLength={30} hint={t`e.g. wC1, wC2, Damen 2`} />
        <Field label={t`Age group`}>
          {(id) => (
            <select id={id} class="select" value={ageClassCode} onChange={(e) => setAgeClassCode((e.target as HTMLSelectElement).value)}>
              {classes.map((a) => (
                <option value={a.code}>
                  {a.name} ({a.code})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t`Gender`}>
          {(id) => (
            <select id={id} class="select" value={gender} onChange={(e) => setGender((e.target as HTMLSelectElement).value as TeamGender)}>
              <option value="f">{t`female`}</option>
              <option value="m">{t`male`}</option>
              <option value="x">{t`mixed`}</option>
            </select>
          )}
        </Field>
        {!classes.length && ages.data ? (
          <Notice kind="warn">
            <Trans>
              The season has no age groups yet. Choose a sport in the step before, or add them under <a href="/verwaltung/altersklassen">age groups</a>.
            </Trans>
          </Notice>
        ) : null}
        {problem ? <Notice kind="warn">{problem}</Notice> : null}
        <Button icon="plus" disabled={!name.trim() || !ageClassCode} onClick={add}>
          <Trans>Create team</Trans>
        </Button>
      </section>
      <Button variant="ghost" block icon="download" onClick={() => setMode("import")}>
        <Trans>Import from lists instead</Trans>
      </Button>
      <Button variant="primary" block onClick={onNext}>
        <Trans>Continue</Trans>
      </Button>
    </>
  );
}

interface PersonRow {
  person: { id: number; firstName: string; lastName: string | null };
  isAdmin: boolean;
  hasAccount: boolean;
  teams: { name: string; role: string; isGroup: boolean }[];
}

/**
 * The first coaches and admins: create them, assign coaches to the teams of the step before, and hand each one a
 * personal link. Players and parents come later through the coaches' invitation links.
 */
function PeopleStep({ onNext }: { onNext: () => void }) {
  const { me } = useSession();
  const persons = useQuery<{ persons: PersonRow[] }>("/admin/persons");
  const teams = useQuery<{ teams: TeamRow[] }>("/teams");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [teamIds, setTeamIds] = useState<number[]>([]);
  const [admin, setAdmin] = useState(false);
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const teamList = (teams.data?.teams ?? []).filter((x) => x.kind === "team");
  // Everyone with a role here except oneself
  const people = (persons.data?.persons ?? []).filter(
    (p) => p.person.id !== me?.person.id && (p.isAdmin || p.teams.some((m) => m.role === "coach")),
  );

  const add = async () => {
    setProblem(null);
    try {
      const { id } = await api.post<{ id: number }>("/admin/persons", { firstName: firstName.trim(), lastName: lastName.trim() || null });
      for (const teamId of teamIds) await api.post(`/teams/${teamId}/members`, { personId: id, role: "coach" });
      if (admin) await api.patch(`/admin/persons/${id}`, { isAdmin: true, adminEmail: email.trim() || null });
      const name = firstName.trim();
      toast(t`${name} is created. Now send the personal link.`);
      setFirstName("");
      setLastName("");
      setTeamIds([]);
      setAdmin(false);
      setEmail("");
      invalidate("/admin/persons", "/teams", "/chat");
    } catch (err) {
      setProblem(errorMessage(err));
      invalidate("/admin/persons");
    }
  };

  return (
    <>
      <p class="muted">
        <Trans>
          Who starts with you? Create your coaches and further admins and send each a personal link to sign in. Players and parents come later through the
          coaches' invitation links.
        </Trans>
      </p>
      {persons.error ? <ErrorBox error={persons.error} onRetry={persons.reload} /> : null}
      {people.length ? (
        <ul class="list" aria-label={t`First people`}>
          {people.map((p) => (
            <PersonLinkRow key={p.person.id} p={p} />
          ))}
        </ul>
      ) : null}
      <section class="card card-pad stack" aria-label={t`New person`}>
        <TextField label={t`First name`} value={firstName} onInput={setFirstName} maxLength={60} autoComplete="off" />
        <TextField label={t`Last name`} value={lastName} onInput={setLastName} maxLength={60} autoComplete="off" />
        {teamList.length ? (
          <div class="field" role="group" aria-label={t`Coach of`}>
            <span class="field-label">
              <Trans>Coach of</Trans>
            </span>
            <div class="chips">
              {teamList.map((team) => (
                <button
                  type="button"
                  class={`chip ${teamIds.includes(team.id) ? "selected" : ""}`}
                  aria-pressed={teamIds.includes(team.id) ? "true" : "false"}
                  onClick={() => setTeamIds(teamIds.includes(team.id) ? teamIds.filter((x) => x !== team.id) : [...teamIds, team.id])}
                >
                  {team.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p class="small muted">
            <Trans>Without teams there is nothing to coach yet; you can assign coaches later under administration → teams.</Trans>
          </p>
        )}
        <SwitchRow label={t`Admin`} sub={t`Manages the club in the app, like you.`} checked={admin} onChange={setAdmin} />
        {admin ? (
          <TextField
            label={t`E-mail address`}
            type="email"
            inputMode="email"
            value={email}
            onInput={setEmail}
            autoComplete="off"
            hint={t`Optional here. Admins need one for signing in; otherwise they enter it when they open their link.`}
          />
        ) : null}
        {problem ? <Notice kind="warn">{problem}</Notice> : null}
        <Button icon="plus" disabled={!firstName.trim() || (admin && !!email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))} onClick={add}>
          <Trans>Create person</Trans>
        </Button>
      </section>
      <Button variant="primary" block onClick={onNext}>
        {people.length ? <Trans>Continue</Trans> : <Trans>Skip for now</Trans>}
      </Button>
    </>
  );
}

/** A person of the step with roles and their personal link. */
function PersonLinkRow({ p }: { p: PersonRow }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const teamNames = p.teams
    .filter((m) => m.role === "coach")
    .map((m) => m.name)
    .join(", ");
  const roles = [p.isAdmin ? t`Admin` : null, teamNames ? t`Coach of ${teamNames}` : null].filter(Boolean).join(" · ");
  const validUntil = link ? fullDate(isoToLocalDate(link.expiresAt)) : "";
  return (
    <li class="card card-pad stack-sm">
      <div>
        <strong>{personName(p.person)}</strong>
        <div class="small muted">{roles}</div>
      </div>
      {p.hasAccount ? (
        <p class="small muted">
          <Trans>Has access.</Trans>
        </p>
      ) : !link ? (
        <Button icon="link" onClick={async () => setLink(await api.post<{ url: string; expiresAt: string }>(`/persons/${p.person.id}/personal-link`, {}))}>
          <Trans>Create personal link</Trans>
        </Button>
      ) : (
        <div class="stack-sm">
          <QrLink url={link.url} />
          <div class="url-box">{link.url}</div>
          <div class="btn-row">
            <Button
              variant="primary"
              icon="share"
              onClick={() => {
                const club = clubName();
                shareLink(club, t`Your personal access to the ${club} app`, link.url);
              }}
            >
              <Trans>Share</Trans>
            </Button>
            <Button icon="copy" onClick={() => copyText(link.url)}>
              <Trans>Copy</Trans>
            </Button>
          </div>
          <p class="small muted">
            <Trans>Valid until {validUntil}, can only be used once.</Trans>
          </p>
        </div>
      )}
    </li>
  );
}

function PrivacyStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <Notice icon="info">
        <Trans>
          The app stores only first name, last name and birth year of players and parents, plus e-mail address and mobile number if someone enters them for signing
          in. Profile pictures of minors need their parents' consent. The privacy page of the app explains this to everyone.
        </Trans>
      </Notice>
      <p class="muted">
        <Trans>Link your club's privacy policy and legal notice, and name a contact for questions about the app.</Trans>
      </p>
      <ClubProfileForm
        parts={["privacy"]}
        submitLabel={t`Save and continue`}
        onSaved={async () => {
          // The last step finishes the setup and waits for the server, so "set up" is only shown once it is true
          await api.post("/admin/setup/done", {});
          await loadClub();
          onNext();
        }}
      />
    </>
  );
}

function DoneStep({ onRestart }: { onRestart: () => void }) {
  const club = useClub();
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (club.setupDone) return;
    api
      .post("/admin/setup/done", {})
      .then(() => loadClub())
      .catch((err) => setProblem(errorMessage(err)));
  }, []);
  const steps: { href: string; title: string; sub: string }[] = [
    { href: "/team", title: t`Add players and training plans`, sub: t`Coaches do this in their team: import players from a list, enter training times, send invitations.` },
    { href: "/verwaltung/personen", title: t`More coaches and admins`, sub: t`Under people: create them, assign teams, hand out personal links. A second admin helps when you are away.` },
    { href: "/verwaltung/ferien", title: t`Check holidays`, sub: t`School holidays and public holidays of your region are already there.` },
  ];
  return (
    <>
      {problem ? <Notice kind="warn">{problem}</Notice> : null}
      <div class="card card-pad stack">
        <div class="row-gap">
          <span class="logo-mark" style={{ width: "44px", height: "44px", fontSize: "18px" }} aria-hidden="true">
            <Icon name="check" size={26} stroke={3} />
          </span>
          <h2 style={{ fontSize: "26px" }}>
            <Trans>The app is set up</Trans>
          </h2>
        </div>
        <p>
          <Trans>Coaches and players come next. These are the usual steps.</Trans>
        </p>
      </div>
      <ul class="list" aria-label={t`Next steps`}>
        {steps.map((s) => (
          <li>
            <a class="list-row" href={s.href}>
              <span class="main">
                <span class="title">{s.title}</span>
                <span class="sub">{s.sub}</span>
              </span>
              <Icon name="chevron" size={18} />
            </a>
          </li>
        ))}
      </ul>
      <a class="btn btn-primary btn-block" href="/">
        <Trans>Go to the app</Trans>
      </a>
      <Button variant="ghost" block onClick={onRestart}>
        <Trans>Start again from the beginning</Trans>
      </Button>
    </>
  );
}

function sessionStorageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionStorageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // private mode: the wizard just starts again at the first step
  }
}

export function setupPostponed(): boolean {
  return sessionStorageGet(SETUP_LATER_KEY) === "1";
}

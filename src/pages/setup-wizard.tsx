// Setup wizard: leads the first admin through language, club, sport and season, modules, e-mail,
// first teams and privacy. Opens after the installation and can be reopened under administration.
// Every step saves through the normal administration routes, so nothing is lost when leaving early.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useLocation } from "preact-iso";
import { useEffect, useState } from "preact/hooks";
import { seasonAround, SPORTS, type SportId, type TeamGender } from "../../shared/sports";
import { api, errorMessage } from "../api";
import { loadClub, useClub } from "../club";
import { fullDate, todayLocal } from "../format";
import { currentLocale } from "../i18n";
import { LanguageSwitch } from "../language-switch";
import { Icon } from "../icons";
import { useSession } from "../session";
import { invalidate, useQuery } from "../store";
import { Button, ErrorBox, Field, Notice, Spinner, TextField, toast, TopBar, useDocumentTitle } from "../ui";
import { AdminOnly } from "./admin";
import { ClubProfileForm } from "./club-settings";
import { MailSettingsForm } from "./mail-settings";

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

type StepId = "language" | "club" | "sport" | "modules" | "mail" | "teams" | "privacy" | "done";
const STEPS: StepId[] = ["language", "club", "sport", "modules", "mail", "teams", "privacy", "done"];

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
    return Number.isInteger(saved) && saved > 0 && saved < STEPS.length ? saved : 0;
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
          {step === "privacy" ? <PrivacyStep onNext={next} /> : null}
          {step === "done" ? <DoneStep /> : null}
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

function TeamsStep({ onNext }: { onNext: () => void }) {
  const { refresh } = useSession();
  const teams = useQuery<{ teams: TeamRow[] }>("/teams");
  const ages = useQuery<{ ageClasses: { code: string; name: string }[] }>("/age-classes");
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
      invalidate("/teams");
      await refresh();
    } catch (err) {
      setProblem(errorMessage(err));
    }
  };

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
      <Button variant="primary" block onClick={onNext}>
        <Trans>Continue</Trans>
      </Button>
    </>
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
      <ClubProfileForm parts={["privacy"]} submitLabel={t`Save and continue`} onSaved={onNext} />
    </>
  );
}

function DoneStep() {
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
    { href: "/verwaltung/mannschaften", title: t`Assign coaches`, sub: t`Under teams → coaches. Each coach gets a personal link to sign in.` },
    { href: "/team", title: t`Add players and training plans`, sub: t`Coaches do this in their team: import players from a list, enter training times, send invitations.` },
    { href: "/verwaltung/ferien", title: t`Check holidays`, sub: t`School holidays and public holidays of your region are already there.` },
    { href: "/verwaltung/personen", title: t`Add more admins`, sub: t`A second admin helps when you are away.` },
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

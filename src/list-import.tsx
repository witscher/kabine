// List import in the setup wizard: the club's spreadsheets (several files, several sheets) or pasted tables become
// teams, coaches and players. Everything is read and checked in this browser (shared/list-import.ts); only the
// confirmed names, birth years, teams and roles go to the server, in one step at the end. Until then the draft is
// kept in this browser so that a reload loses nothing; it is deleted after the import or when discarded.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "preact/hooks";
import {
  cellText,
  IMPORT_FIELDS,
  mergeRows,
  parseDelimited,
  resolveSame,
  rowsOfSheet,
  sheetFromRows,
  suggestTeams,
  type ImportAgeClass,
  type ImportField,
  type ImportPerson,
  type ImportQuestion,
  type ImportRole,
  type ImportSheet,
  type ImportTeam,
} from "../shared/list-import";
import { api, errorMessage } from "./api";
import type { AppModule } from "./module-api";
import { useActiveModules } from "./modules";
import { Button, Field, Notice, toast } from "./ui";

const DRAFT_KEY = "kabine.setup.listImport";

interface Draft {
  stage: "sources" | "review";
  sheets: ImportSheet[];
  persons: ImportPerson[];
  questions: ImportQuestion[];
  teams: ImportTeam[];
}

const emptyDraft = (): Draft => ({ stage: "sources", sheets: [], persons: [], questions: [], teams: [] });

function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function saveDraft(draft: Draft | null): void {
  try {
    if (draft && (draft.sheets.length || draft.persons.length)) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private window or full storage: the import works, a reload starts over
  }
}

/** A list import was started in this browser and not finished. */
export const hasListImportDraft = () => !!loadDraft();

function fieldLabel(f: ImportField): string {
  switch (f) {
    case "ignore":
      return t`Ignore`;
    case "name":
      return t`Full name`;
    case "firstName":
      return t`First name`;
    case "lastName":
      return t`Last name`;
    case "birthYear":
      return t`Birth year`;
    case "birthDate":
      return t`Date of birth`;
    case "team":
      return t`Team`;
    case "role":
      return t`Role`;
  }
}

function roleLabel(r: ImportRole): string {
  return r === "coach" ? t`Coach` : r === "staff" ? t({ message: "Staff", context: "team role" }) : t`Player`;
}

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

type Assist = NonNullable<AppModule["listImport"]>;
/** Help of a module the club switched on (AI list import), if any. */
const useAssist = (): Assist | null => useActiveModules().find((m) => m.listImport)?.listImport ?? null;

export function ListImport(props: { ageClasses: ImportAgeClass[]; existingTeams: string[]; onDone: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => loadDraft() ?? emptyDraft());
  useEffect(() => saveDraft(draft), [draft]);
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const discard = () => {
    saveDraft(null);
    props.onCancel();
  };
  return draft.stage === "sources" ? (
    <Sources
      draft={draft}
      update={update}
      onDiscard={discard}
      onRead={() => {
        const { persons, questions } = mergeRows(draft.sheets.flatMap(rowsOfSheet));
        update({ stage: "review", persons, questions, teams: suggestTeams(persons, props.ageClasses, props.existingTeams) });
        window.scrollTo(0, 0);
      }}
    />
  ) : (
    <Review
      draft={draft}
      update={update}
      ageClasses={props.ageClasses}
      onBack={() => update({ stage: "sources" })}
      onDiscard={discard}
      onDone={() => {
        saveDraft(null);
        props.onDone();
      }}
    />
  );
}

// Step 1: the lists ----------------------------------------------------------------------------------------

function Sources({ draft, update, onRead, onDiscard }: { draft: Draft; update: (p: Partial<Draft>) => void; onRead: () => void; onDiscard: () => void }) {
  const [paste, setPaste] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const assist = useAssist();
  const add = (sheets: ImportSheet[]) => update({ sheets: [...draft.sheets, ...sheets.filter((s) => s.rows.length)] });
  const nextId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const readFiles = async (files: FileList) => {
    setProblem(null);
    setBusy(true);
    const sheets: ImportSheet[] = [];
    try {
      for (const file of Array.from(files)) {
        if (/\.xlsx$/i.test(file.name)) {
          // Loaded only here: the spreadsheet reader is not part of the app for everyone else
          const { default: readXlsxFile } = await import("read-excel-file/browser");
          for (const s of await readXlsxFile(file)) {
            sheets.push(sheetFromRows(nextId(), file.name, s.sheet, s.data.map((row) => row.map(cellText))));
          }
        } else if (/\.(csv|tsv|txt)$/i.test(file.name)) {
          sheets.push(sheetFromRows(nextId(), file.name, "", parseDelimited(await file.text())));
        } else {
          const name = file.name;
          setProblem(t`${name}: please save it as .xlsx or .csv (older .xls files cannot be read).`);
        }
      }
      add(sheets);
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setSheet = (id: string, patch: Partial<ImportSheet>) => update({ sheets: draft.sheets.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const usable = draft.sheets.filter((s) => s.mapping.includes("name") || s.mapping.includes("firstName") || s.mapping.includes("lastName"));
  const rowCount = usable.reduce((n, s) => n + s.rows.length, 0);

  return (
    <>
      <p class="muted">
        <Trans>
          Add your lists: Excel files (.xlsx) with one or more sheets, CSV files, or a table copied from anywhere. The same person may appear in several lists;
          they are combined into one.
        </Trans>
      </p>
      <Notice>
        <Trans>
          The lists are read in this browser and are not uploaded. Only first name, last name, birth year, team and role are kept; columns such as phone
          number or address are ignored. Nothing is saved in the app until you confirm the import at the end.
        </Trans>
      </Notice>
      <section class="card card-pad stack" aria-label={t`Add lists`}>
        <Field label={t`Files`}>
          {(id) => (
            <input
              id={id}
              type="file"
              class="input"
              multiple
              accept=".xlsx,.csv,.tsv,.txt"
              disabled={busy}
              onChange={(e) => {
                const input = e.target as HTMLInputElement;
                if (input.files?.length) void readFiles(input.files).then(() => (input.value = ""));
              }}
            />
          )}
        </Field>
        <Field label={t`Or paste a table`} hint={t`Copy the cells including the header row, e.g. from Excel or Google Sheets.`}>
          {(id) => (
            <textarea
              id={id}
              class="textarea"
              rows={4}
              value={paste}
              placeholder={"Name\tJahrgang\tMannschaft\nMuster, Kim\t2014\twD1"}
              onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)}
            />
          )}
        </Field>
        <Button
          icon="plus"
          disabled={!paste.trim()}
          onClick={() => {
            const n = draft.sheets.filter((s) => !s.sheet && s.file.startsWith("#")).length + 1;
            add([sheetFromRows(nextId(), `#${n}`, "", parseDelimited(paste))]);
            setPaste("");
          }}
        >
          <Trans>Add pasted table</Trans>
        </Button>
        {problem ? <Notice kind="warn">{problem}</Notice> : null}
      </section>

      {assist && draft.sheets.length ? <p class="small muted">{assist.notice()}</p> : null}
      {draft.sheets.map((s) => (
        <SheetCard key={s.id} sheet={s} assist={assist} onChange={(patch) => setSheet(s.id, patch)} onRemove={() => update({ sheets: draft.sheets.filter((x) => x.id !== s.id) })} />
      ))}

      <Button variant="primary" block disabled={!rowCount} onClick={onRead}>
        {plural(rowCount, { one: "Read # row", other: "Read # rows" })}
      </Button>
      <Button variant="ghost" block onClick={onDiscard}>
        {draft.sheets.length ? <Trans>Discard and enter by hand</Trans> : <Trans>Enter by hand instead</Trans>}
      </Button>
    </>
  );
}

function sheetTitle(s: ImportSheet): string {
  const n = s.file.slice(1);
  const base = s.file.startsWith("#") ? t`Pasted table ${n}` : s.file;
  return s.sheet ? `${base} · ${s.sheet}` : base;
}

function SheetCard({
  sheet,
  assist,
  onChange,
  onRemove,
}: {
  sheet: ImportSheet;
  assist: Assist | null;
  onChange: (p: Partial<ImportSheet>) => void;
  onRemove: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const hasName = sheet.mapping.some((f) => f === "name" || f === "firstName" || f === "lastName");
  const unclear = sheet.mapping.some((f, i) => f === "ignore" && sheet.rows.some((r) => r[i]));
  const askAi = async () => {
    setProblem(null);
    try {
      // Samples only of columns without a header: a header like "Telefon" says enough, its numbers stay here
      const samples = sheet.rows.slice(0, 3).map((r) => r.map((c, i) => (sheet.header[i]?.trim() ? "" : c)));
      const suggested = await assist!.columns(sheet.header, samples);
      const used = new Set(sheet.mapping.filter((f) => f !== "ignore"));
      const mapping = sheet.mapping.map((f, i) => {
        const s = suggested[i] ?? "ignore";
        if (f !== "ignore" || s === "ignore" || used.has(s)) return f;
        used.add(s);
        return s;
      });
      const count = mapping.filter((f, i) => f !== sheet.mapping[i]).length;
      onChange({ mapping });
      toast(count ? plural(count, { one: "# column recognised", other: "# columns recognised" }) : t`No further columns recognised`);
    } catch (err) {
      setProblem(errorMessage(err));
    }
  };
  const count = sheet.rows.length;
  const preview = sheet.rows.slice(0, 3);
  return (
    <section class="card card-pad stack-sm" aria-label={sheetTitle(sheet)}>
      <div class="row-gap" style={{ justifyContent: "space-between" }}>
        <strong>{sheetTitle(sheet)}</strong>
        <button type="button" class="link-btn" onClick={onRemove}>
          <Trans>Remove</Trans>
        </button>
      </div>
      <p class="small muted">{plural(count, { one: "# row below the header", other: "# rows below the header" })}</p>
      <ul class="list" aria-label={t`Columns`}>
        {sheet.header.map((h, i) => {
          const samples = preview.map((r) => r[i]).filter(Boolean).join(" · ");
          const ignored = sheet.mapping[i] === "ignore";
          return (
            <li class="list-row">
              <span class="main" style={ignored ? { opacity: 0.5 } : {}}>
                <span class="title">{h || "–"}</span>
                {/* Ignored columns show no content, e.g. phone numbers */}
                <span class="sub">{ignored ? "" : samples}</span>
              </span>
              <select
                class="select"
                style={{ width: "auto", maxWidth: "48%" }}
                aria-label={t`Column ${h}`}
                value={sheet.mapping[i]}
                onChange={(e) => onChange({ mapping: sheet.mapping.map((f, j) => (j === i ? ((e.target as HTMLSelectElement).value as ImportField) : f)) })}
              >
                {IMPORT_FIELDS.map((f) => (
                  <option value={f}>{fieldLabel(f)}</option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
      {assist && (unclear || !hasName) ? (
        <div class="stack-sm">
          <Button icon="star" onClick={askAi}>
            <Trans>Recognise columns with AI</Trans>
          </Button>
          {problem ? <Notice kind="warn">{problem}</Notice> : null}
        </div>
      ) : null}
      {!hasName ? (
        <Notice kind="warn">
          <Trans>Choose the column with the names, otherwise this list is not read.</Trans>
        </Notice>
      ) : null}
      {!sheet.mapping.includes("team") ? (
        <Field label={t`Team for everyone in this list`} hint={t`Leave empty if the team follows from another list.`}>
          {(id) => <input id={id} class="input" maxLength={30} value={sheet.team} onInput={(e) => onChange({ team: (e.target as HTMLInputElement).value })} />}
        </Field>
      ) : null}
      <Field label={sheet.mapping.includes("role") ? t`Role where the column is empty` : t`Everyone in this list is`}>
        {(id) => (
          <select id={id} class="select" value={sheet.role} onChange={(e) => onChange({ role: (e.target as HTMLSelectElement).value as ImportRole })}>
            {(["player", "coach", "staff"] as const).map((r) => (
              <option value={r}>{roleLabel(r)}</option>
            ))}
          </select>
        )}
      </Field>
    </section>
  );
}

// Step 2: check and correct ---------------------------------------------------------------------------------

function Review(props: {
  draft: Draft;
  update: (p: Partial<Draft>) => void;
  ageClasses: ImportAgeClass[];
  onBack: () => void;
  onDiscard: () => void;
  onDone: () => void;
}) {
  const { draft, update } = props;
  const [problem, setProblem] = useState<string | null>(null);
  const assist = useAssist();
  const byKey = new Map(draft.persons.map((p) => [p.key, p]));
  const active = draft.persons.filter((p) => !p.excluded);
  const usedTeams = new Set(active.flatMap((p) => p.memberships.map((m) => m.team)));
  const teams = draft.teams.filter((tm) => usedTeams.has(tm.name));
  const openQuestions = draft.questions.filter((q) => (q.kind === "maybe-same" ? q.keys.every((k) => byKey.has(k)) : byKey.has(q.key) && !byKey.get(q.key)!.excluded));
  const missingClass = teams.filter((tm) => !tm.existing && !tm.ageClassCode);

  const setPerson = (key: string, patch: Partial<ImportPerson>) => update({ persons: draft.persons.map((p) => (p.key === key ? { ...p, ...patch } : p)) });
  const dropQuestion = (q: ImportQuestion) => update({ questions: draft.questions.filter((x) => x !== q) });
  const renameTeam = (from: string, to: string) =>
    update({
      teams: draft.teams.map((tm) => (tm.name === from ? { ...tm, name: to } : tm)),
      persons: draft.persons.map((p) => ({ ...p, memberships: p.memberships.map((m) => (m.team === from ? { ...m, team: to } : m)) })),
    });

  const commit = async () => {
    setProblem(null);
    try {
      const res = await api.post<{ teamsCreated: number; personsCreated: number; personsFound: number }>("/admin/import/commit", {
        teams: teams.map(({ name, ageClassCode, gender }) => ({ name, ageClassCode, gender })),
        persons: active
          .filter((p) => p.memberships.length)
          .map((p) => ({ firstName: p.firstName.trim(), lastName: p.lastName.trim(), birthYear: p.birthYear, memberships: p.memberships })),
      });
      const persons = res.personsCreated;
      const created = res.teamsCreated;
      toast(`${plural(created, { one: "# team", other: "# teams" })} · ${plural(persons, { one: "# person imported", other: "# persons imported" })}`);
      props.onDone();
    } catch (err) {
      setProblem(errorMessage(err));
    }
  };

  const unclearNames = active.filter((p) => p.rawName && p.doubts.includes("name"));
  const unclearCount = unclearNames.length;
  const askAi = async () => {
    setProblem(null);
    try {
      const names = await assist!.names(unclearNames.map((p) => p.rawName!));
      const found = new Map(unclearNames.map((p, i) => [p.key, names[i] ?? null]));
      update({
        persons: draft.persons.map((p) => {
          const n = found.get(p.key);
          if (!n) return p;
          const birthYear = p.birthYear ?? n.birthYear;
          return { ...p, firstName: n.firstName, lastName: n.lastName, birthYear, birthYears: birthYear ? [birthYear] : p.birthYears, doubts: ["ai"] };
        }),
      });
      const count = names.filter(Boolean).length;
      toast(plural(count, { one: "# name read by the AI, please check", other: "# names read by the AI, please check" }));
    } catch (err) {
      setProblem(errorMessage(err));
    }
  };

  const personCount = active.filter((p) => p.memberships.length).length;
  const teamCount = teams.length;
  const questionCount = openQuestions.length;
  const ready = !questionCount && !missingClass.length && personCount > 0;

  return (
    <>
      <p class="muted">
        <Trans>
          Check what was read. Correct names, birth years and roles where needed; rows marked “check” were not clear. Nothing is saved until you import.
        </Trans>
      </p>

      {assist && unclearNames.length ? (
        <section class="card card-pad stack-sm" aria-label={t`Unclear names`}>
          <p>{plural(unclearCount, { one: "# name could not be split surely into first and last name.", other: "# names could not be split surely into first and last name." })}</p>
          <Button icon="star" onClick={askAi}>
            <Trans>Read names with AI</Trans>
          </Button>
          <p class="small muted">{assist.notice()}</p>
        </section>
      ) : null}

      {questionCount ? (
        <section class="card card-pad stack-sm" aria-label={t`Questions`}>
          <h2 class="section-title" style={{ margin: 0 }}>
            {plural(questionCount, { one: "# question", other: "# questions" })}
          </h2>
          {openQuestions.map((q) => (
            <QuestionRow
              q={q}
              byKey={byKey}
              teams={teams.map((tm) => tm.name)}
              onSame={(keep, drop) => update(resolveSame(draft.persons, draft.questions, keep, drop))}
              onYear={(key, year) => {
                update({ persons: draft.persons.map((p) => (p.key === key ? { ...p, birthYear: year, birthYears: [year] } : p)), questions: draft.questions.filter((x) => x !== q) });
              }}
              onTeam={(key, team) => {
                update({
                  persons: draft.persons.map((p) => (p.key === key ? { ...p, memberships: [{ team, role: "player" }] } : p)),
                  questions: draft.questions.filter((x) => x !== q),
                });
              }}
              onExclude={(key) => update({ persons: draft.persons.map((p) => (p.key === key ? { ...p, excluded: true } : p)), questions: draft.questions.filter((x) => x !== q) })}
              onDismiss={() => dropQuestion(q)}
            />
          ))}
        </section>
      ) : null}

      <section class="card card-pad stack-sm" aria-label={t`Teams`}>
        <h2 class="section-title" style={{ margin: 0 }}>
          {plural(teamCount, { one: "# team", other: "# teams" })}
        </h2>
        {teams.map((tm) => (
          <div class="stack-sm" style={{ borderTop: "1px solid var(--line)", paddingTop: "8px" }}>
            <input class="input" aria-label={t`Team name`} maxLength={30} value={tm.name} onChange={(e) => renameTeam(tm.name, (e.target as HTMLInputElement).value.trim() || tm.name)} />
            {tm.existing ? (
              <p class="small muted">
                <Trans>exists already, members are added</Trans>
              </p>
            ) : (
              <div class="grid-2">
                <select
                  class="select"
                  aria-label={t`Age group`}
                  value={tm.ageClassCode}
                  onChange={(e) => update({ teams: draft.teams.map((x) => (x.name === tm.name ? { ...x, ageClassCode: (e.target as HTMLSelectElement).value } : x)) })}
                >
                  {!tm.ageClassCode ? <option value="">{t`Please choose`}</option> : null}
                  {props.ageClasses.map((a) => (
                    <option value={a.code}>{a.name}</option>
                  ))}
                </select>
                <select
                  class="select"
                  aria-label={t`Gender`}
                  value={tm.gender}
                  onChange={(e) => update({ teams: draft.teams.map((x) => (x.name === tm.name ? { ...x, gender: (e.target as HTMLSelectElement).value as ImportTeam["gender"] } : x)) })}
                >
                  <option value="f">{t`female`}</option>
                  <option value="m">{t`male`}</option>
                  <option value="x">{t`mixed`}</option>
                </select>
              </div>
            )}
          </div>
        ))}
      </section>

      {teams.map((tm) => (
        <TeamPeople key={tm.name} team={tm.name} persons={active.filter((p) => p.memberships.some((m) => m.team === tm.name))} setPerson={setPerson} />
      ))}

      {draft.persons.some((p) => p.excluded) ? (
        <details class="card card-pad">
          <summary>{t`Left out`}</summary>
          <ul class="list">
            {draft.persons
              .filter((p) => p.excluded)
              .map((p) => (
                <li class="list-row">
                  <span class="main">
                    <span class="title">{fullName(p)}</span>
                  </span>
                  <button type="button" class="link-btn" onClick={() => setPerson(p.key, { excluded: false })}>
                    <Trans>Take back</Trans>
                  </button>
                </li>
              ))}
          </ul>
        </details>
      ) : null}

      {missingClass.length ? (
        <Notice kind="warn">
          <Trans>Choose an age group for every new team.</Trans>
        </Notice>
      ) : null}
      {questionCount ? (
        <Notice kind="warn">
          <Trans>Answer the questions above first.</Trans>
        </Notice>
      ) : null}
      {problem ? <Notice kind="warn">{problem}</Notice> : null}
      <Button variant="primary" block disabled={!ready} onClick={commit}>
        {plural(personCount, { one: "Import # person", other: "Import # persons" })}
      </Button>
      <Button block onClick={props.onBack}>
        <Trans>Back to the lists</Trans>
      </Button>
      <Button variant="ghost" block onClick={props.onDiscard}>
        <Trans>Discard and enter by hand</Trans>
      </Button>
    </>
  );
}

function describe(p: ImportPerson): string {
  const teams = p.memberships.map((m) => (m.role === "player" ? m.team : `${m.team} (${roleLabel(m.role)})`)).join(", ");
  return [fullName(p), p.birthYear ? String(p.birthYear) : null, teams || null].filter(Boolean).join(" · ");
}

function QuestionRow(props: {
  q: ImportQuestion;
  byKey: Map<string, ImportPerson>;
  teams: string[];
  onSame: (keep: string, drop: string) => void;
  onYear: (key: string, year: number) => void;
  onTeam: (key: string, team: string) => void;
  onExclude: (key: string) => void;
  onDismiss: () => void;
}) {
  const { q, byKey } = props;
  if (q.kind === "maybe-same") {
    const [a, b] = q.keys.map((k) => byKey.get(k)!) as [ImportPerson, ImportPerson];
    const aName = fullName(a);
    const bName = fullName(b);
    return (
      <div class="stack-sm" style={{ borderTop: "1px solid var(--line)", paddingTop: "8px" }}>
        <p>
          <Trans>The same person?</Trans>
        </p>
        <p class="small">
          {describe(a)}
          <br />
          {describe(b)}
        </p>
        <div class="btn-row">
          <Button size="sm" onClick={() => props.onSame(a.key, b.key)}>
            {t`Same, named ${aName}`}
          </Button>
          <Button size="sm" onClick={() => props.onSame(b.key, a.key)}>
            {t`Same, named ${bName}`}
          </Button>
          <Button size="sm" variant="ghost" onClick={props.onDismiss}>
            <Trans>Two people</Trans>
          </Button>
        </div>
      </div>
    );
  }
  const p = byKey.get(q.key)!;
  const name = fullName(p);
  return (
    <div class="stack-sm" style={{ borderTop: "1px solid var(--line)", paddingTop: "8px" }}>
      {q.kind === "birth-year" ? (
        <>
          <p>
            <Trans>The lists give different birth years for {name}.</Trans>
          </p>
          <div class="btn-row">
            {q.years.map((y) => (
              <Button size="sm" onClick={() => props.onYear(p.key, y)}>
                {String(y)}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p>
            <Trans>{name} is in no team.</Trans>
          </p>
          <div class="btn-row">
            <select class="select" aria-label={t`Team for ${name}`} value="" onChange={(e) => props.onTeam(p.key, (e.target as HTMLSelectElement).value)}>
              <option value="">{t`Choose a team`}</option>
              {props.teams.map((tm) => (
                <option value={tm}>{tm}</option>
              ))}
            </select>
            <Button size="sm" variant="ghost" onClick={() => props.onExclude(p.key)}>
              <Trans>Leave out</Trans>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function TeamPeople({ team, persons, setPerson }: { team: string; persons: ImportPerson[]; setPerson: (key: string, patch: Partial<ImportPerson>) => void }) {
  const coaches = persons.filter((p) => p.memberships.some((m) => m.team === team && m.role === "coach")).length;
  const players = persons.filter((p) => p.memberships.some((m) => m.team === team && m.role === "player")).length;
  const doubtful = persons.filter((p) => p.doubts.length).length;
  return (
    <details class="card card-pad" open={doubtful > 0}>
      <summary>
        <strong>{team}</strong>
        {` · ${plural(players, { one: "# player", other: "# players" })} · ${plural(coaches, { one: "# coach", other: "# coaches" })}`}
        {doubtful ? <span class="badge warn" style={{ marginLeft: "8px" }}>{plural(doubtful, { one: "# to check", other: "# to check" })}</span> : null}
      </summary>
      {persons.map((p) => {
        const roles = p.memberships.filter((m) => m.team === team).map((m) => m.role);
        const name = fullName(p);
        const source = p.sources.map((s) => `${s.file.startsWith("#") ? t`pasted` : s.file}${s.sheet ? ` · ${s.sheet}` : ""}, ${t`row`} ${s.row}`).join("; ");
        return (
          <div class="stack-sm" style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
            <div class="grid-2">
              <input class="input" aria-label={t`First name of ${name}`} maxLength={50} value={p.firstName} onChange={(e) => setPerson(p.key, { firstName: (e.target as HTMLInputElement).value, doubts: [] })} />
              <input class="input" aria-label={t`Last name of ${name}`} maxLength={50} value={p.lastName} onChange={(e) => setPerson(p.key, { lastName: (e.target as HTMLInputElement).value, doubts: [] })} />
              <input
                class="input"
                aria-label={t`Birth year of ${name}`}
                inputMode="numeric"
                placeholder={t`Year`}
                value={p.birthYear ?? ""}
                onChange={(e) => {
                  const y = Number((e.target as HTMLInputElement).value);
                  const ok = y >= 1930 && y <= 2100;
                  setPerson(p.key, { birthYear: ok ? y : null, birthYears: ok ? [y] : [], doubts: [] });
                }}
              />
              <select
                class="select"
                aria-label={t`Role of ${name}`}
                value={roles.join("+")}
                onChange={(e) => {
                  const value = (e.target as HTMLSelectElement).value;
                  const others = p.memberships.filter((m) => m.team !== team);
                  setPerson(p.key, { memberships: [...others, ...(value ? value.split("+").map((r) => ({ team, role: r as ImportRole })) : [])] });
                }}
              >
                {[...new Set(["player", "coach", "staff", "player+coach", roles.join("+")])].filter(Boolean).map((r) => (
                  <option value={r}>{r.split("+").map((x) => roleLabel(x as ImportRole)).join(" + ")}</option>
                ))}
                <option value="">{t`Not in this team`}</option>
              </select>
            </div>
            <div class="row-gap small">
              {p.doubts.includes("ai") ? <span class="badge warn">{t`AI, check`}</span> : p.doubts.length ? <span class="badge warn">{t`check`}</span> : null}
              <span class="muted" style={{ flex: 1 }}>{source}</span>
              <button type="button" class="link-btn" onClick={() => setPerson(p.key, { excluded: true })}>
                <Trans>Leave out</Trans>
              </button>
            </div>
          </div>
        );
      })}
    </details>
  );
}

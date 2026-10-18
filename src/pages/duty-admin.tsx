// Verwaltung → Helferdienste: Dienstarten und Vorlagen (nur Admins ändern).
import { useState } from "preact/hooks";
import { api } from "../api";
import type { DutyTypeInfo, TemplateInfo } from "../duty-blocks";
import { Icon } from "../icons";
import { useMe } from "../session";
import { invalidate, useQuery } from "../store";
import { Button, confirmDialog, ErrorBox, Field, Notice, Segmented, Sheet, Spinner, SwitchRow, TextField, toast, TopBar, useDocumentTitle } from "../ui";

type TemplateItem = TemplateInfo["items"][number];

function whoLabel(t: DutyTypeInfo): string {
  if (t.whoReferees) return "KiHaSL-Rolle";
  if (t.whoParents && t.whoPlayers && t.whoCoaches) return t.whoMembers ? "Alle, Mitglieder" : "Alle";
  return [t.whoParents && "Eltern", t.whoPlayers && "Spieler", t.whoCoaches && "Trainer", t.whoMembers && "Mitglieder"].filter(Boolean).join(", ");
}

function typeSub(t: DutyTypeInfo): string {
  return [
    `Wer hilft: ${whoLabel(t)}`,
    t.mode === "task" ? "Aufgabe" : null,
    t.noteAllowed ? "mit Notiz" : null,
    t.needsSkill ? "braucht Vorkenntnisse" : null,
    t.archived ? "archiviert" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function AdminDutiesPage() {
  useDocumentTitle("Helferdienste");
  const me = useMe();
  const types = useQuery<{ types: DutyTypeInfo[] }>(me.isAdmin ? "/duty-types?all=1" : null);
  const templates = useQuery<{ templates: TemplateInfo[] }>(me.isAdmin ? "/duty-templates" : null);
  const [editType, setEditType] = useState<DutyTypeInfo | "new" | null>(null);
  const [editTemplate, setEditTemplate] = useState<TemplateInfo | "new" | null>(null);
  if (!me.isAdmin) {
    return (
      <main class="page">
        <TopBar title="Helferdienste" back="/verwaltung" />
        <div class="content">
          <Notice kind="warn">Dieser Bereich ist nur für Admins.</Notice>
        </div>
      </main>
    );
  }
  const reload = () => {
    void types.reload();
    void templates.reload();
    invalidate("/duties");
  };
  const allTypes = types.data?.types ?? [];
  return (
    <main class="page">
      <TopBar title="Helferdienste" kicker="Verwaltung" back="/verwaltung" />
      <div class="content">
        {types.error ? <ErrorBox error={types.error} onRetry={types.reload} /> : null}
        {templates.error ? <ErrorBox error={templates.error} onRetry={templates.reload} /> : null}
        {!types.data || !templates.data ? <Spinner /> : null}

        <section class="stack-sm" aria-label="Dienstarten">
          <h2 class="section-title">Dienstarten</h2>
          <p class="small muted">Was es im Verein gibt und wer helfen darf.</p>
          <ul class="list">
            {allTypes.map((t) => (
              <li>
                <button type="button" class={`list-row ${t.archived ? "muted" : ""}`} onClick={() => setEditType(t)}>
                  <span class="main">
                    <span class="title">{t.name}</span>
                    <span class="sub">{typeSub(t)}</span>
                  </span>
                  <Icon name="chevron" size={18} />
                </button>
              </li>
            ))}
          </ul>
          <Button variant="dashed" size="sm" icon="plus" onClick={() => setEditType("new")}>
            Dienstart hinzufügen
          </Button>
        </section>

        <section class="stack-sm" aria-label="Vorlagen">
          <h2 class="section-title">Vorlagen</h2>
          <p class="small muted">Welche Dienste ein Spiel braucht, mit Plätzen und Zeitraum rund um den Termin. Trainer wählen in ihrer Mannschaft die Vorlage für Heim- und Auswärtsspiele.</p>
          <ul class="list">
            {(templates.data?.templates ?? []).map((t) => (
              <li>
                <button type="button" class="list-row" onClick={() => setEditTemplate(t)}>
                  <span class="main">
                    <span class="title">{t.name}</span>
                    <span class="sub">
                      {t.defaultFor === "home" ? "Standard für Heimspiele · " : t.defaultFor === "away" ? "Standard für Auswärtsspiele · " : ""}
                      {t.items.length === 1 ? "1 Dienst" : `${t.items.length} Dienste`}
                    </span>
                  </span>
                  <Icon name="chevron" size={18} />
                </button>
              </li>
            ))}
          </ul>
          <Button variant="dashed" size="sm" icon="plus" onClick={() => setEditTemplate("new")}>
            Vorlage hinzufügen
          </Button>
        </section>
      </div>

      {editType ? <DutyTypeSheet type={editType === "new" ? null : editType} onClose={() => setEditType(null)} onDone={reload} /> : null}
      {editTemplate ? (
        <TemplateSheet template={editTemplate === "new" ? null : editTemplate} types={allTypes} onClose={() => setEditTemplate(null)} onDone={reload} />
      ) : null}
    </main>
  );
}

function DutyTypeSheet({ type, onClose, onDone }: { type: DutyTypeInfo | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(type?.name ?? "");
  const [mode, setMode] = useState<"onsite" | "task">(type?.mode ?? "onsite");
  const [who, setWho] = useState({
    parents: type?.whoParents ?? true,
    players: type?.whoPlayers ?? false,
    coaches: type?.whoCoaches ?? false,
    members: type?.whoMembers ?? false,
  });
  const [noteAllowed, setNoteAllowed] = useState(type?.noteAllowed ?? false);
  const [needsSkill, setNeedsSkill] = useState(type?.needsSkill ?? false);
  const [archived, setArchived] = useState(type?.archived ?? false);
  const referee = type?.whoReferees ?? false;
  const all = who.parents && who.players && who.coaches;
  const chip = (label: string, on: boolean, toggle: () => void) => (
    <button type="button" class={`chip ${on ? "selected" : ""}`} aria-pressed={on ? "true" : "false"} onClick={toggle}>
      {label}
    </button>
  );
  return (
    <Sheet open onClose={onClose} title={type ? type.name : "Neue Dienstart"}>
      <TextField label="Name" value={name} onInput={setName} maxLength={40} placeholder="z. B. Grill" />
      {referee ? (
        <p class="small muted">Wer diesen Dienst übernimmt, legt die KiHaSL/JuHaSL-Rolle fest. Hier lässt sich nur der Name ändern.</p>
      ) : (
        <>
          <div class="field" role="group" aria-label="Wer hilft">
            <span class="field-label">Wer hilft</span>
            <div class="chips">
              {chip("Eltern", who.parents, () => setWho({ ...who, parents: !who.parents }))}
              {chip("Spieler", who.players, () => setWho({ ...who, players: !who.players }))}
              {chip("Trainer", who.coaches, () => setWho({ ...who, coaches: !who.coaches }))}
              {chip("Mitglieder", who.members, () => setWho({ ...who, members: !who.members }))}
              {chip("Alle", all, () => setWho(all ? { ...who, parents: true, players: false, coaches: false } : { ...who, parents: true, players: true, coaches: true }))}
            </div>
            <span class="small muted">
              Eltern tragen sich für ihr Kind ein. In Mannschaften ohne Eltern übernehmen das die Spieler selbst. Mitglieder: ordentliche Mitglieder des Vereins, die zur Mannschaft
              gehören (Merkmal setzen Admins unter Personen).
            </span>
          </div>
          <Segmented
            label="Art"
            value={mode}
            onChange={setMode}
            options={[
              { value: "onsite", label: "Vor Ort" },
              { value: "task", label: "Aufgabe" },
            ]}
          />
          <p class="small muted">
            {mode === "onsite" ? "Vor Ort: anwesend in einem Zeitraum, etwa an der Theke." : "Aufgabe: wird vor oder nach dem Termin erledigt, etwa Trikots waschen."}
          </p>
          <ul class="list">
            <li>
              <SwitchRow label="Notiz erlaubt" sub="Wer sich einträgt, kann etwas dazuschreiben, z. B. welcher Kuchen." checked={noteAllowed} onChange={setNoteAllowed} />
            </li>
            <li>
              <SwitchRow
                label="Braucht Vorkenntnisse"
                sub="Angeboten wird der Dienst nur, wer ihn im Profil unter „Das kann ich“ einschaltet."
                checked={needsSkill}
                onChange={setNeedsSkill}
              />
            </li>
            {type ? (
              <li>
                <SwitchRow label="Archiviert" sub="Nicht mehr für neue Vorlagen und Zeitblöcke wählbar. Bestehende Dienste bleiben." checked={archived} onChange={setArchived} />
              </li>
            ) : null}
          </ul>
        </>
      )}
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!name.trim() || (!referee && !who.parents && !who.players && !who.coaches && !who.members)}
        onClick={async () => {
          const body = { name: name.trim(), mode, whoParents: who.parents, whoPlayers: who.players, whoCoaches: who.coaches, whoMembers: who.members, noteAllowed, needsSkill, archived };
          if (type) await api.patch(`/admin/duty-types/${type.id}`, body);
          else await api.post("/admin/duty-types", body);
          toast("Gespeichert.");
          onDone();
          onClose();
        }}
      >
        Speichern
      </Button>
    </Sheet>
  );
}

function TemplateSheet({ template, types, onClose, onDone }: { template: TemplateInfo | null; types: DutyTypeInfo[]; onClose: () => void; onDone: () => void }) {
  const choices = types.filter((t) => !t.whoReferees && (!t.archived || template?.items.some((i) => i.dutyTypeId === t.id)));
  const [name, setName] = useState(template?.name ?? "");
  const [items, setItems] = useState<TemplateItem[]>(template?.items ?? []);
  const typeOf = (id: number) => types.find((t) => t.id === id);
  const update = (i: number, patch: Partial<TemplateItem>) => setItems(items.map((it, n) => (n === i ? { ...it, ...patch } : it)));
  return (
    <Sheet open onClose={onClose} title={template ? template.name : "Neue Vorlage"}>
      <TextField label="Name" value={name} onInput={setName} maxLength={40} placeholder="z. B. Heimspiel mit Grill" />
      <p class="small muted">
        Zeiten beziehen sich auf Beginn und Ende des Termins. Bei Spielen ist der Beginn der Anpfiff, das Ende ergibt sich aus der Spieldauer der Altersklasse. Bei Sonderterminen gelten Beginn und Ende des
        Termins.
      </p>
      {items.map((it, i) => {
        const t = typeOf(it.dutyTypeId);
        return (
          <section class="tpl-item" aria-label={t?.name ?? "Dienst"}>
            <div class="tpl-item-head">
              <Field label="Dienst">
                {(id) => (
                  <select id={id} class="select" value={String(it.dutyTypeId)} onChange={(e) => update(i, { dutyTypeId: Number((e.target as HTMLSelectElement).value) })}>
                    {choices.map((c) => (
                      <option value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                )}
              </Field>
              <button type="button" class="icon-btn icon-btn-sm" aria-label={`${t?.name ?? "Dienst"} entfernen`} onClick={() => setItems(items.filter((_, n) => n !== i))}>
                <Icon name="trash" size={16} />
              </button>
            </div>
            {t?.mode === "task" ? (
              <Segmented
                label="Wann"
                value={it.taskWhen}
                onChange={(v) => update(i, { taskWhen: v })}
                options={[
                  { value: "before", label: "Davor" },
                  { value: "after", label: "Danach" },
                ]}
              />
            ) : (
              <div class="tpl-minutes">
                <label>
                  <input
                    class="input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={600}
                    step={5}
                    value={it.beforeMin}
                    aria-label="Minuten vor Beginn"
                    onInput={(e) => update(i, { beforeMin: clampMin((e.target as HTMLInputElement).value) })}
                  />{" "}
                  min vor Beginn
                </label>
                <span>bis</span>
                <label>
                  <input
                    class="input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={600}
                    step={5}
                    value={it.afterMin}
                    aria-label="Minuten nach Ende"
                    onInput={(e) => update(i, { afterMin: clampMin((e.target as HTMLInputElement).value) })}
                  />{" "}
                  min nach Ende
                </label>
              </div>
            )}
            <div class="duty-stepper">
              <span>Plätze</span>
              <button type="button" class="icon-btn icon-btn-sm" aria-label="Ein Platz weniger" onClick={() => update(i, { slots: Math.max(1, it.slots - 1) })}>
                −
              </button>
              <strong aria-live="polite">{it.slots}</strong>
              <button type="button" class="icon-btn icon-btn-sm" aria-label="Ein Platz mehr" onClick={() => update(i, { slots: Math.min(20, it.slots + 1) })}>
                +
              </button>
            </div>
          </section>
        );
      })}
      <Button
        variant="dashed"
        size="sm"
        icon="plus"
        disabled={!choices.length}
        onClick={() => setItems([...items, { dutyTypeId: choices[0]!.id, slots: 1, beforeMin: 0, afterMin: 0, taskWhen: "after" }])}
      >
        Dienst hinzufügen
      </Button>
      <p class="small muted">0 heißt genau zum Beginn bzw. Ende. Änderungen gelten für kommende Spiele, bei denen sich noch niemand eingetragen hat.</p>
      <p class="small muted">
        KiHaSL/JuHaSL steht in keiner Vorlage: Bei Heimspielen der Jugend F bis C kommt der Dienst immer automatisch dazu (1 Platz, 15 min vor Anpfiff bis Spielende).
      </p>
      <Button
        variant="primary"
        size="lg"
        block
        disabled={!name.trim()}
        onClick={async () => {
          const body = { name: name.trim(), items };
          if (template) await api.put(`/admin/duty-templates/${template.id}`, body);
          else await api.post("/admin/duty-templates", body);
          toast("Vorlage gespeichert.");
          onDone();
          onClose();
        }}
      >
        Speichern
      </Button>
      {template && !template.defaultFor ? (
        <Button
          variant="danger"
          icon="trash"
          onClick={async () => {
            if (!(await confirmDialog({ title: `Vorlage ${template.name} löschen?`, message: "Mannschaften mit dieser Vorlage nutzen danach wieder den Standard.", confirmLabel: "Löschen", danger: true }))) return;
            await api.del(`/admin/duty-templates/${template.id}`);
            toast("Vorlage gelöscht.");
            onDone();
            onClose();
          }}
        >
          Vorlage löschen
        </Button>
      ) : null}
    </Sheet>
  );
}

function clampMin(v: string): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(600, n)) : 0;
}

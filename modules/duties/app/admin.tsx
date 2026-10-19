// Admin → Helper duties: duty types and templates (only admins change them).
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import { api } from "../../../src/api";
import type { DutyTypeInfo, TemplateInfo } from "../../../src/duty-blocks";
import { Icon } from "../../../src/icons";
import { useMe } from "../../../src/session";
import { invalidate, useQuery } from "../../../src/store";
import { Button, confirmDialog, ErrorBox, Field, Notice, Segmented, Sheet, Spinner, SwitchRow, TextField, toast, TopBar, useDocumentTitle } from "../../../src/ui";

type TemplateItem = TemplateInfo["items"][number];

function whoLabel(type: DutyTypeInfo): string {
  if (type.whoReferees) return t`KiHaSL role`;
  if (type.whoParents && type.whoPlayers && type.whoCoaches) return type.whoMembers ? t`All, members` : t`All`;
  return [
    type.whoParents && t`Parents`,
    type.whoPlayers && t({ message: "Players", context: "short" }),
    type.whoCoaches && t({ message: "Coaches", context: "short" }),
    type.whoMembers && t`Members`,
  ]
    .filter(Boolean)
    .join(", ");
}

function typeSub(type: DutyTypeInfo): string {
  const who = whoLabel(type);
  return [
    t`Who helps: ${who}`,
    type.mode === "task" ? t`Task` : null,
    type.noteAllowed ? t`with note` : null,
    type.needsSkill ? t`needs prior knowledge` : null,
    type.archived ? t`archived` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function AdminDutiesPage() {
  useDocumentTitle(t`Helper duties`);
  const me = useMe();
  const types = useQuery<{ types: DutyTypeInfo[] }>(me.isAdmin ? "/duty-types?all=1" : null);
  const templates = useQuery<{ templates: TemplateInfo[] }>(me.isAdmin ? "/duty-templates" : null);
  const [editType, setEditType] = useState<DutyTypeInfo | "new" | null>(null);
  const [editTemplate, setEditTemplate] = useState<TemplateInfo | "new" | null>(null);
  if (!me.isAdmin) {
    return (
      <main class="page">
        <TopBar title={t`Helper duties`} back="/verwaltung" />
        <div class="content">
          <Notice kind="warn">
            <Trans>This area is for admins only.</Trans>
          </Notice>
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
      <TopBar title={t`Helper duties`} kicker={t`Administration`} back="/verwaltung" />
      <div class="content">
        {types.error ? <ErrorBox error={types.error} onRetry={types.reload} /> : null}
        {templates.error ? <ErrorBox error={templates.error} onRetry={templates.reload} /> : null}
        {!types.data || !templates.data ? <Spinner /> : null}

        <section class="stack-sm" aria-label={t`Duty types`}>
          <h2 class="section-title">
            <Trans>Duty types</Trans>
          </h2>
          <p class="small muted">
            <Trans>What the club has and who may help.</Trans>
          </p>
          <ul class="list">
            {allTypes.map((type) => (
              <li>
                <button type="button" class={`list-row ${type.archived ? "muted" : ""}`} onClick={() => setEditType(type)}>
                  <span class="main">
                    <span class="title">{type.name}</span>
                    <span class="sub">{typeSub(type)}</span>
                  </span>
                  <Icon name="chevron" size={18} />
                </button>
              </li>
            ))}
          </ul>
          <Button variant="dashed" size="sm" icon="plus" onClick={() => setEditType("new")}>
            <Trans>Add duty type</Trans>
          </Button>
        </section>

        <section class="stack-sm" aria-label={t`Templates`}>
          <h2 class="section-title">
            <Trans>Templates</Trans>
          </h2>
          <p class="small muted">
            <Trans>Which duties a game needs, with slots and time span around the event. Coaches choose the template for home and away games in their team.</Trans>
          </p>
          <ul class="list">
            {(templates.data?.templates ?? []).map((tpl) => {
              const count = tpl.items.length;
              return (
                <li>
                  <button type="button" class="list-row" onClick={() => setEditTemplate(tpl)}>
                    <span class="main">
                      <span class="title">{tpl.name}</span>
                      <span class="sub">
                        {tpl.defaultFor === "home" ? `${t`Default for home games`} · ` : tpl.defaultFor === "away" ? `${t`Default for away games`} · ` : ""}
                        {plural(count, { one: "# duty", other: "# duties" })}
                      </span>
                    </span>
                    <Icon name="chevron" size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
          <Button variant="dashed" size="sm" icon="plus" onClick={() => setEditTemplate("new")}>
            <Trans>Add template</Trans>
          </Button>
        </section>
      </div>

      {editType ? <DutyTypeSheet type={editType === "new" ? null : editType} onClose={() => setEditType(null)} onDone={reload} /> : null}
      {editTemplate ? <TemplateSheet template={editTemplate === "new" ? null : editTemplate} types={allTypes} onClose={() => setEditTemplate(null)} onDone={reload} /> : null}
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
    <Sheet open onClose={onClose} title={type ? type.name : t`New duty type`}>
      <TextField label={t`Name`} value={name} onInput={setName} maxLength={40} placeholder={t`e.g. barbecue`} />
      {referee ? (
        <p class="small muted">
          <Trans>Who takes on this duty is set by the KiHaSL/JuHaSL role. Only the name can be changed here.</Trans>
        </p>
      ) : (
        <>
          <div class="field" role="group" aria-label={t`Who helps`}>
            <span class="field-label">
              <Trans>Who helps</Trans>
            </span>
            <div class="chips">
              {chip(t`Parents`, who.parents, () => setWho({ ...who, parents: !who.parents }))}
              {chip(t({ message: "Players", context: "short" }), who.players, () => setWho({ ...who, players: !who.players }))}
              {chip(t({ message: "Coaches", context: "short" }), who.coaches, () => setWho({ ...who, coaches: !who.coaches }))}
              {chip(t`Members`, who.members, () => setWho({ ...who, members: !who.members }))}
              {chip(t`All`, all, () => setWho(all ? { ...who, parents: true, players: false, coaches: false } : { ...who, parents: true, players: true, coaches: true }))}
            </div>
            <span class="small muted">
              <Trans>
                Parents sign up for their child. In teams without parents, the players do this themselves. Members: full members of the club who belong to the team (admins set this
                under People).
              </Trans>
            </span>
          </div>
          <Segmented
            label={t`Kind`}
            value={mode}
            onChange={setMode}
            options={[
              { value: "onsite", label: t`On site` },
              { value: "task", label: t`Task` },
            ]}
          />
          <p class="small muted">
            {mode === "onsite" ? t`On site: present during a time span, for example at the counter.` : t`Task: done before or after the event, for example washing the shirts.`}
          </p>
          <ul class="list">
            <li>
              <SwitchRow label={t`Note allowed`} sub={t`Whoever signs up can add something, e.g. which cake.`} checked={noteAllowed} onChange={setNoteAllowed} />
            </li>
            <li>
              <SwitchRow
                label={t`Needs prior knowledge`}
                sub={t`The duty is only offered to those who turn it on in their profile under “I can do this”.`}
                checked={needsSkill}
                onChange={setNeedsSkill}
              />
            </li>
            {type ? (
              <li>
                <SwitchRow label={t`Archived`} sub={t`No longer available for new templates and time slots. Existing duties remain.`} checked={archived} onChange={setArchived} />
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
          const body = {
            name: name.trim(),
            mode,
            whoParents: who.parents,
            whoPlayers: who.players,
            whoCoaches: who.coaches,
            whoMembers: who.members,
            noteAllowed,
            needsSkill,
            archived,
          };
          if (type) await api.patch(`/admin/duty-types/${type.id}`, body);
          else await api.post("/admin/duty-types", body);
          toast(t`Saved.`);
          onDone();
          onClose();
        }}
      >
        <Trans>Save</Trans>
      </Button>
    </Sheet>
  );
}

function TemplateSheet({ template, types, onClose, onDone }: { template: TemplateInfo | null; types: DutyTypeInfo[]; onClose: () => void; onDone: () => void }) {
  const choices = types.filter((ty) => !ty.whoReferees && (!ty.archived || template?.items.some((i) => i.dutyTypeId === ty.id)));
  const [name, setName] = useState(template?.name ?? "");
  const [items, setItems] = useState<TemplateItem[]>(template?.items ?? []);
  const typeOf = (id: number) => types.find((ty) => ty.id === id);
  const update = (i: number, patch: Partial<TemplateItem>) => setItems(items.map((it, n) => (n === i ? { ...it, ...patch } : it)));
  return (
    <Sheet open onClose={onClose} title={template ? template.name : t`New template`}>
      <TextField label={t`Name`} value={name} onInput={setName} maxLength={40} placeholder={t`e.g. home game with barbecue`} />
      <p class="small muted">
        <Trans>
          Times refer to the start and end of the event. For games, they begin with the start of play and end after the game length of the age group. For special events, the
          start and end of the event apply.
        </Trans>
      </p>
      {items.map((it, i) => {
        const type = typeOf(it.dutyTypeId);
        const label = type?.name ?? t`Duty`;
        return (
          <section class="tpl-item" aria-label={label}>
            <div class="tpl-item-head">
              <Field label={t`Duty`}>
                {(id) => (
                  <select
                    id={id}
                    class="select"
                    value={String(it.dutyTypeId)}
                    onChange={(e) =>
                      update(i, {
                        dutyTypeId: Number((e.target as HTMLSelectElement).value),
                      })
                    }
                  >
                    {choices.map((c) => (
                      <option value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                )}
              </Field>
              <button type="button" class="icon-btn icon-btn-sm" aria-label={t`Remove ${label}`} onClick={() => setItems(items.filter((_, n) => n !== i))}>
                <Icon name="trash" size={16} />
              </button>
            </div>
            {type?.mode === "task" ? (
              <Segmented
                label={t`When`}
                value={it.taskWhen}
                onChange={(v) => update(i, { taskWhen: v })}
                options={[
                  { value: "before", label: t`Before` },
                  { value: "after", label: t`After` },
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
                    aria-label={t`Minutes before start`}
                    onInput={(e) =>
                      update(i, {
                        beforeMin: clampMin((e.target as HTMLInputElement).value),
                      })
                    }
                  />{" "}
                  <Trans>min before start</Trans>
                </label>
                <span>
                  <Trans>to</Trans>
                </span>
                <label>
                  <input
                    class="input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={600}
                    step={5}
                    value={it.afterMin}
                    aria-label={t`Minutes after end`}
                    onInput={(e) =>
                      update(i, {
                        afterMin: clampMin((e.target as HTMLInputElement).value),
                      })
                    }
                  />{" "}
                  <Trans>min after end</Trans>
                </label>
              </div>
            )}
            <div class="duty-stepper">
              <span>
                <Trans>Slots</Trans>
              </span>
              <button type="button" class="icon-btn icon-btn-sm" aria-label={t`One slot fewer`} onClick={() => update(i, { slots: Math.max(1, it.slots - 1) })}>
                −
              </button>
              <strong aria-live="polite">{it.slots}</strong>
              <button type="button" class="icon-btn icon-btn-sm" aria-label={t`One slot more`} onClick={() => update(i, { slots: Math.min(20, it.slots + 1) })}>
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
        onClick={() =>
          setItems([
            ...items,
            {
              dutyTypeId: choices[0]!.id,
              slots: 1,
              beforeMin: 0,
              afterMin: 0,
              taskWhen: "after",
            },
          ])
        }
      >
        <Trans>Add duty</Trans>
      </Button>
      <p class="small muted">
        <Trans>0 means exactly at the start or end. Changes apply to upcoming games where no one has signed up yet.</Trans>
      </p>
      <p class="small muted">
        <Trans>
          KiHaSL/JuHaSL is not part of any template: for youth home games F to C the duty is always added automatically (1 slot, 15 min before throw-off until the end of the game).
        </Trans>
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
          toast(t`Template saved.`);
          onDone();
          onClose();
        }}
      >
        <Trans>Save</Trans>
      </Button>
      {template && !template.defaultFor ? (
        <Button
          variant="danger"
          icon="trash"
          onClick={async () => {
            const templateName = template.name;
            if (
              !(await confirmDialog({
                title: t`Delete template ${templateName}?`,
                message: t`Teams with this template will then use the default again.`,
                confirmLabel: t`Delete`,
                danger: true,
              }))
            )
              return;
            await api.del(`/admin/duty-templates/${template.id}`);
            toast(t`Template deleted.`);
            onDone();
            onClose();
          }}
        >
          <Trans>Delete template</Trans>
        </Button>
      ) : null}
    </Sheet>
  );
}

function clampMin(v: string): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(600, n)) : 0;
}

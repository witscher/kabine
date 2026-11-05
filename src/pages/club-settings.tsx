// Club profile: name, abbreviation, colours, logo, privacy notice, contact. Under Administration → Club every card
// saves on its own: switches, choices and colours at once, text fields with the card's button
// (docs/dev/design.md, Saving). In the setup wizard the same parts are one form with "Save and continue".
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import { type ClubModules, type ClubProfile, isHexColor, KABINE_SOURCE } from "../../shared/club";
import type { ModuleManifest } from "../../shared/module-api";
import { MODULES, type ModuleId, moduleOffered } from "../../shared/modules";
import { LOCALE_NAMES, LOCALES, type Locale } from "../../shared/i18n";
import { useQuery } from "../store";
import { api, errorMessage } from "../api";
import { loadRegionHolidays } from "../holidays";
import { ClubMark, loadClub, setClub, useClub } from "../club";
import { currentLocale } from "../i18n";
import { useSession } from "../session";
import { Button, confirmDialog, Field, Notice, SavedNote, SwitchRow, TextField, toast, TopBar, useDocumentTitle, useSaving } from "../ui";
import { AdminOnly } from "./admin";

const LOGO_TYPES = "image/png,image/jpeg,image/webp,image/svg+xml";

export type ClubFormPart = "name" | "look" | "region" | "modules" | "privacy";
const ALL_PARTS: ClubFormPart[] = ["name", "look", "region", "modules", "privacy"];

/**
 * The whole club profile, or some parts of it. As a form (setup wizard) one button saves all fields; with `cards`
 * (Administration → Club) each card saves on its own.
 */
export function ClubProfileForm({
  onSaved,
  submitLabel,
  parts = ALL_PARTS,
  cards = false,
}: {
  onSaved?: () => void | Promise<void>;
  submitLabel?: string;
  parts?: ClubFormPart[];
  cards?: boolean;
}) {
  const club = useClub();
  const { refresh: refreshSession } = useSession();
  const show = (p: ClubFormPart) => parts.includes(p);
  const [name, setName] = useState(club.name);
  const [shortName, setShortName] = useState(club.shortName);
  const [abbr, setAbbr] = useState(club.abbr);
  const [primary, setPrimary] = useState(club.colors.primary);
  const [accent, setAccent] = useState(club.colors.accent);
  const [legalNoticeUrl, setLegalNoticeUrl] = useState(club.legalNoticeUrl ?? "");
  const [privacyUrl, setPrivacyUrl] = useState(club.privacyUrl ?? "");
  const [privacyText, setPrivacyText] = useState(club.privacyText ?? "");
  const [contact, setContact] = useState(club.contact ?? "");
  const [sourceUrl, setSourceUrl] = useState(club.sourceUrl ?? "");
  // A fresh installation proposes the language the admin uses the app in, not the built-in default
  const [defaultLocale, setDefaultLocale] = useState<Locale>(club.setupDone ? club.defaultLocale : currentLocale());
  const [country, setCountry] = useState(club.country);
  const [subdivision, setSubdivision] = useState(club.subdivision ?? "");
  const [timeZone, setTimeZone] = useState(club.timeZone);
  const [modules, setModules] = useState<ClubModules>(club.modules);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!isHexColor(primary) || !isHexColor(accent)) return setError(t`Please choose two colours.`);
    try {
      const saved = await api.put<ClubProfile>("/admin/club", {
        name: name.trim(),
        shortName: shortName.trim(),
        abbr: abbr.trim(),
        colors: { primary, accent },
        legalNoticeUrl: legalNoticeUrl.trim() || null,
        privacyUrl: privacyUrl.trim() || null,
        privacyText: privacyText.trim() || null,
        contact: contact.trim() || null,
        sourceUrl: sourceUrl.trim() || null,
        defaultLocale,
        country,
        subdivision: subdivision || null,
        timeZone,
        modules,
      });
      setClub(saved);
      // Saving the switches marks new modules as seen (dot and "New" badge)
      void refreshSession();
      toast(t`Saved`);
      // A new region brings its holidays for the current season (otherwise only at the season change)
      if (show("region") && saved.subdivision && (saved.subdivision !== club.subdivision || saved.country !== club.country)) {
        await loadRegionHolidays(true);
      }
      await onSaved?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  // Cards: saves some fields at once and takes the saved profile
  const patch = async (fields: Partial<ClubProfile>) => {
    const saved = await api.put<ClubProfile>("/admin/club", fields);
    setClub(saved);
    return saved;
  };
  const lookSaving = useSaving();
  const saveColor = (which: "primary" | "accent", value: string) => {
    if (!cards || !isHexColor(value)) return;
    void lookSaving.run(patch({ colors: { primary: which === "primary" ? value : primary, accent: which === "accent" ? value : accent } }));
  };
  const nameChanged = name !== club.name || shortName !== club.shortName || abbr !== club.abbr;
  const privacyChanged =
    legalNoticeUrl !== (club.legalNoticeUrl ?? "") ||
    privacyUrl !== (club.privacyUrl ?? "") ||
    privacyText !== (club.privacyText ?? "") ||
    contact !== (club.contact ?? "") ||
    sourceUrl !== (club.sourceUrl ?? "");
  const saveCard = async (fields: Partial<ClubProfile>) => {
    setError(null);
    try {
      await patch(fields);
      toast(t`Saved`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      await api.upload("/admin/club/logo", file);
      await loadClub();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <div class="stack">
      {show("name") ? (
        <section class="card card-pad stack" aria-label={t`Name`}>
          <TextField label={t`Name of the club`} value={name} onInput={setName} maxLength={80} hint={t`For example “SV Musterstadt 1900 Handball”`} required />
          <TextField label={t`Short name`} value={shortName} onInput={setShortName} maxLength={24} hint={t`On the home screen and in notifications`} required />
          <TextField
            label={t`Abbreviation`}
            value={abbr}
            onInput={setAbbr}
            maxLength={8}
            hint={t`Before your own team in game titles, e.g. “SVM wD – HSG Gegner”. Empty: initials of the short name.`}
          />
          {cards && nameChanged ? (
            <Button variant="primary" disabled={!name.trim() || !shortName.trim()} onClick={() => void saveCard({ name: name.trim(), shortName: shortName.trim(), abbr: abbr.trim() })}>
              <Trans>Save name</Trans>
            </Button>
          ) : null}
        </section>
      ) : null}
      {show("look") ? (
        <section class="card card-pad stack" aria-label={t`Colours and logo`}>
          <div class="club-preview" style={{ "--black": primary, "--yellow": accent }}>
            <ClubMark />
            <strong>{shortName || t`Short name`}</strong>
          </div>
          <div class="club-colors">
            <Field label={t`Main colour`}>
              {(id) => (
                <input
                  id={id}
                  type="color"
                  class="color-input"
                  value={primary}
                  onInput={(e) => setPrimary((e.target as HTMLInputElement).value)}
                  onChange={(e) => saveColor("primary", (e.target as HTMLInputElement).value)}
                />
              )}
            </Field>
            <Field label={t`Accent colour`}>
              {(id) => (
                <input
                  id={id}
                  type="color"
                  class="color-input"
                  value={accent}
                  onInput={(e) => setAccent((e.target as HTMLInputElement).value)}
                  onChange={(e) => saveColor("accent", (e.target as HTMLInputElement).value)}
                />
              )}
            </Field>
          </div>
          <div class="row-gap" style={{ justifyContent: "space-between" }}>
            <p class="small muted">
              <Trans>The main colour should be dark and the accent colour light, so text stays easy to read on both.</Trans>
            </p>
            <SavedNote show={lookSaving.saved} />
          </div>
          <div class="row-gap">
            <label class="btn btn-dashed">
              <Trans>Upload logo</Trans>
              <input type="file" accept={LOGO_TYPES} class="sr-only" onChange={(e) => void uploadLogo((e.target as HTMLInputElement).files?.[0])} />
            </label>
            {club.logoVersion ? (
              <Button
                variant="ghost"
                icon="trash"
                onClick={async () => {
                  await api.del("/admin/club/logo");
                  await loadClub();
                }}
              >
                <Trans>Remove logo</Trans>
              </Button>
            ) : null}
          </div>
          <p class="small muted">
            <Trans>PNG, JPEG, WebP or SVG, at most 256 KB. Without a logo the app shows the abbreviation.</Trans>
          </p>
        </section>
      ) : null}
      {show("region") && cards ? <RegionCard /> : null}
      {show("region") && !cards ? (
        <RegionSection
          locale={defaultLocale}
          onLocale={setDefaultLocale}
          country={country}
          onCountry={(c) => {
            setCountry(c);
            setSubdivision("");
          }}
          subdivision={subdivision}
          onSubdivision={setSubdivision}
          timeZone={timeZone}
          onTimeZone={setTimeZone}
        />
      ) : null}
      {show("modules") ? (
        <ModulesSection
          modules={cards ? club.modules : modules}
          onChange={
            cards
              ? async (m) => {
                  await patch({ modules: m });
                  // Saving the switches marks new modules as seen (dot and "New" badge)
                  void refreshSession();
                }
              : setModules
          }
          confirmOff={cards}
        />
      ) : null}
      {show("privacy") ? (
        <section class="card card-pad stack" aria-label={t`Privacy and contact`}>
          <p class="small muted">
            <Trans>
              Your club is the provider of this app and responsible for its data. Link the club's legal notice and privacy policy, for example on the club
              website. Both appear under every screen and every e-mail of the app.
            </Trans>
          </p>
          {!legalNoticeUrl.trim() || !privacyUrl.trim() ? (
            <Notice kind="warn">
              <Trans>Without both links the app has no legal notice and no privacy policy.</Trans>
            </Notice>
          ) : null}
          <TextField
            label={t`Link to the legal notice`}
            type="url"
            inputMode="url"
            value={legalNoticeUrl}
            onInput={setLegalNoticeUrl}
            placeholder="https://"
          />
          <TextField
            label={t`Link to the privacy policy`}
            type="url"
            inputMode="url"
            value={privacyUrl}
            onInput={setPrivacyUrl}
            placeholder="https://"
            hint={t`It must also cover this app; the Kabine documentation has a template. The notes on the app itself are already in the app under privacy.`}
          />
          <Field label={t`Additional privacy notes (optional)`}>
            {(id) => (
              <textarea id={id} class="textarea" rows={4} maxLength={5000} value={privacyText} onInput={(e) => setPrivacyText((e.target as HTMLTextAreaElement).value)} />
            )}
          </Field>
          <TextField
            label={t`Contact for the app (optional)`}
            value={contact}
            onInput={setContact}
            maxLength={200}
            hint={t`Name and e-mail address, appears under help`}
          />
          <TextField
            label={t`Source code (optional)`}
            type="url"
            inputMode="url"
            value={sourceUrl}
            onInput={setSourceUrl}
            placeholder={KABINE_SOURCE}
            hint={t`Only if your club runs a changed version of Kabine: the link to your copy. The licence (AGPL) asks you to offer its source code.`}
          />
          {cards && privacyChanged ? (
            <Button
              variant="primary"
              onClick={() =>
                void saveCard({
                  legalNoticeUrl: legalNoticeUrl.trim() || null,
                  privacyUrl: privacyUrl.trim() || null,
                  privacyText: privacyText.trim() || null,
                  contact: contact.trim() || null,
                  sourceUrl: sourceUrl.trim() || null,
                })
              }
            >
              <Trans>Save links and contact</Trans>
            </Button>
          ) : null}
        </section>
      ) : null}
      {error ? <Notice kind="warn">{error}</Notice> : null}
      {cards ? null : (
        <Button variant="primary" block disabled={!name.trim() || !shortName.trim()} onClick={save}>
          {submitLabel ?? t`Save`}
        </Button>
      )}
    </div>
  );
}

export function AdminClubPage() {
  useDocumentTitle(t`Club`);
  return (
    <AdminOnly>
      <main class="page">
        <TopBar title={t`Club`} kicker={t`Administration`} back="/verwaltung" />
        <div class="content">
          <ClubProfileForm cards />
        </div>
      </main>
    </AdminOnly>
  );
}

interface RegionOption {
  code: string;
  name: string;
}

/** Club language, region for holidays and time zone. */
export function RegionSection(props: {
  locale: Locale;
  onLocale: (l: Locale) => void;
  country: string;
  onCountry: (c: string) => void;
  subdivision: string;
  onSubdivision: (s: string) => void;
  timeZone: string;
  onTimeZone: (z: string) => void;
  /** Saving at once (Administration → Club): "Saved" and busy state */
  saved?: boolean;
  busy?: boolean;
}) {
  const regions = useQuery<{ countries: RegionOption[]; subdivisions: RegionOption[] }>(`/admin/regions?country=${props.country}`);
  const countries = regions.data?.countries.length ? regions.data.countries : [{ code: props.country, name: props.country }];
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [props.timeZone];
  return (
    <section class="card card-pad stack" aria-label={t`Language and region`} aria-busy={props.busy ? "true" : undefined}>
      {props.saved !== undefined ? (
        <div class="row-gap" style={{ justifyContent: "flex-end", minHeight: "18px" }}>
          <SavedNote show={props.saved} />
        </div>
      ) : null}
      <Field label={t`Default language`} hint={t`For everyone who has not chosen a language, and for messages outside the app.`}>
        {(id) => (
          <select id={id} class="select" disabled={props.busy} value={props.locale} onChange={(e) => props.onLocale((e.target as HTMLSelectElement).value as Locale)}>
            {LOCALES.map((l) => (
              <option value={l}>{LOCALE_NAMES[l]}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t`Country`}>
        {(id) => (
          <select id={id} class="select" disabled={props.busy} value={props.country} onChange={(e) => props.onCountry((e.target as HTMLSelectElement).value)}>
            {countries.map((c) => (
              <option value={c.code}>{c.name}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t`State or region`} hint={t`For school holidays and public holidays.`}>
        {(id) => (
          <select id={id} class="select" disabled={props.busy} value={props.subdivision} onChange={(e) => props.onSubdivision((e.target as HTMLSelectElement).value)}>
            <option value="">{t`Whole country`}</option>
            {(regions.data?.subdivisions ?? []).map((s) => (
              <option value={s.code}>{s.name}</option>
            ))}
            {props.subdivision && !regions.data?.subdivisions.some((s) => s.code === props.subdivision) ? <option value={props.subdivision}>{props.subdivision}</option> : null}
          </select>
        )}
      </Field>
      <Field label={t`Time zone`}>
        {(id) => (
          <select id={id} class="select" disabled={props.busy} value={props.timeZone} onChange={(e) => props.onTimeZone((e.target as HTMLSelectElement).value)}>
            {zones.map((z) => (
              <option value={z}>{z.replaceAll("_", " ")}</option>
            ))}
          </select>
        )}
      </Field>
    </section>
  );
}

/** Language and region under Administration → Club: every choice saves at once. */
function RegionCard() {
  const club = useClub();
  const saving = useSaving();
  const save = (fields: Partial<ClubProfile>) =>
    void saving.run(
      (async () => {
        const saved = await api.put<ClubProfile>("/admin/club", fields);
        setClub(saved);
        // A new region brings its holidays for the current season (otherwise only at the season change)
        if (saved.subdivision && (saved.subdivision !== club.subdivision || saved.country !== club.country)) await loadRegionHolidays(true);
      })(),
    );
  return (
    <RegionSection
      locale={club.defaultLocale}
      onLocale={(defaultLocale) => save({ defaultLocale })}
      country={club.country}
      onCountry={(country) => save({ country, subdivision: null })}
      subdivision={club.subdivision ?? ""}
      onSubdivision={(s) => save({ subdivision: s || null })}
      timeZone={club.timeZone}
      onTimeZone={(timeZone) => save({ timeZone })}
      saved={saving.saved}
      busy={saving.busy}
    />
  );
}

/**
 * Functions the club uses; switched-off modules disappear from the app and the API. The switches come from
 * the module manifests (modules/<id>/module.ts); modules made for other sports are not offered. Game
 * schedule sources (kind "fixtures") form their own group: the club may switch on several, each team picks
 * one of them.
 */
export function ModulesSection({ modules, onChange, confirmOff = false }: { modules: ClubModules; onChange: (m: ClubModules) => unknown; confirmOff?: boolean }) {
  const club = useClub();
  // Modules the admin has not been told about yet (src/news.tsx) get a "New" badge
  const fresh = new Set(useSession().me?.news?.newModules.map((m) => m.id) ?? []);
  // How many teams use each source, to warn before one is switched off
  const usage = useQuery<{ sources: { id: string; teams: number }[] }>("/admin/fixture-sources");
  // Which modules are offered depends on the club's sport only, never on the switches: a switched-off module stays
  // in the list, so it can be switched on again
  const offered = (MODULES as readonly ModuleManifest[]).filter((m) => moduleOffered(m, club.sport));
  const row = (m: ModuleManifest) => {
    const id = m.id as ModuleId;
    const teams = usage.data?.sources.find((x) => x.id === m.id)?.teams ?? 0;
    // Switched off here while the saved profile has it on and teams use it
    const losing = m.kind === "fixtures" && !modules[id] && club.modules[id] && teams > 0;
    return (
      <div>
        <SwitchRow
          label={
            <>
              {m.label()}
              {fresh.has(m.id) ? <span class="pill pill-yes">{t({ message: "New", context: "module" })}</span> : null}
              {m.status === "beta" ? <span class="pill pill-muted">{t`Beta`}</span> : null}
            </>
          }
          sub={m.description()}
          checked={modules[id]}
          disabled={!!m.requires && !modules[m.requires as ModuleId]}
          onChange={(v) => {
            const next = { ...modules, [id]: v };
            if (!(confirmOff && !v && m.kind === "fixtures" && teams > 0)) return onChange(next);
            // Saving at once: ask before a source that teams use is switched off (false: nothing saved)
            return confirmDialog({
              title: t`Switch off this source?`,
              message: plural(teams, {
                one: "# team takes its games from this source. Its games stay, but they are no longer synced.",
                other: "# teams take their games from this source. Their games stay, but they are no longer synced.",
              }),
              confirmLabel: t`Switch off`,
              danger: true,
            }).then((ok) => (ok ? onChange(next) : false));
          }}
        />
        {losing ? (
          <p class="small warn-text">
            {plural(teams, {
              one: "# team takes its games from this source. Its games stay, but they are no longer synced.",
              other: "# teams take their games from this source. Their games stay, but they are no longer synced.",
            })}
          </p>
        ) : null}
      </div>
    );
  };
  const features = offered.filter((m) => m.kind !== "fixtures");
  const sources = offered.filter((m) => m.kind === "fixtures");
  return (
    <section class="card card-pad stack-sm" aria-label={t`Modules`}>
      <h2 class="section-title" style={{ margin: 0 }}>
        <Trans>Modules</Trans>
      </h2>
      {features.map(row)}
      {sources.length ? (
        <>
          <h3 class="section-title" style={{ margin: "12px 0 0", fontSize: "16px" }}>
            <Trans>Game schedule sources</Trans>
          </h3>
          <p class="small muted">
            <Trans>Each team takes its games from one of the switched-on sources (Team → Settings). Teams without one enter games by hand or from a table.</Trans>
          </p>
          {sources.map(row)}
        </>
      ) : null}
    </section>
  );
}


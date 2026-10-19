// Club profile: name, abbreviation, colours, logo, privacy notice, contact. The form is also a
// step of the setup wizard.
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import { type ClubModules, type ClubProfile, isHexColor, KABINE_SOURCE } from "../../shared/club";
import type { ModuleManifest } from "../../shared/module-api";
import { MODULES, type ModuleId, moduleOffered } from "../../shared/modules";
import { LOCALE_NAMES, LOCALES, type Locale } from "../../shared/i18n";
import { useQuery } from "../store";
import { api, errorMessage } from "../api";
import { ClubMark, loadClub, setClub, useClub } from "../club";
import { currentLocale } from "../i18n";
import { useSession } from "../session";
import { Button, Field, Notice, SwitchRow, TextField, toast, TopBar, useDocumentTitle } from "../ui";
import { AdminOnly } from "./admin";

const LOGO_TYPES = "image/png,image/jpeg,image/webp,image/svg+xml";

export type ClubFormPart = "name" | "look" | "region" | "modules" | "privacy";
const ALL_PARTS: ClubFormPart[] = ["name", "look", "region", "modules", "privacy"];

/** The whole club profile, or some parts of it (steps of the setup wizard). Saving sends all fields. */
export function ClubProfileForm({ onSaved, submitLabel, parts = ALL_PARTS }: { onSaved?: () => void; submitLabel?: string; parts?: ClubFormPart[] }) {
  const club = useClub();
  const { refresh: refreshSession } = useSession();
  const show = (p: ClubFormPart) => parts.includes(p);
  const [name, setName] = useState(club.name);
  const [shortName, setShortName] = useState(club.shortName);
  const [abbr, setAbbr] = useState(club.abbr);
  const [primary, setPrimary] = useState(club.colors.primary);
  const [accent, setAccent] = useState(club.colors.accent);
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
      onSaved?.();
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
              {(id) => <input id={id} type="color" class="color-input" value={primary} onInput={(e) => setPrimary((e.target as HTMLInputElement).value)} />}
            </Field>
            <Field label={t`Accent colour`}>
              {(id) => <input id={id} type="color" class="color-input" value={accent} onInput={(e) => setAccent((e.target as HTMLInputElement).value)} />}
            </Field>
          </div>
          <p class="small muted">
            <Trans>The main colour should be dark and the accent colour light, so text stays easy to read on both.</Trans>
          </p>
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
      {show("region") ? (
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
      {show("modules") ? <ModulesSection modules={modules} onChange={setModules} /> : null}
      {show("privacy") ? (
        <section class="card card-pad stack" aria-label={t`Privacy and contact`}>
          <TextField
            label={t`Link to privacy policy and legal notice`}
            type="url"
            inputMode="url"
            value={privacyUrl}
            onInput={setPrivacyUrl}
            placeholder="https://"
            hint={t`Appears under privacy. The notes on the app itself are already there.`}
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
        </section>
      ) : null}
      {error ? <Notice kind="warn">{error}</Notice> : null}
      <Button variant="primary" block disabled={!name.trim() || !shortName.trim()} onClick={save}>
        {submitLabel ?? t`Save`}
      </Button>
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
          <ClubProfileForm />
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
}) {
  const regions = useQuery<{ countries: RegionOption[]; subdivisions: RegionOption[] }>(`/admin/regions?country=${props.country}`);
  const countries = regions.data?.countries.length ? regions.data.countries : [{ code: props.country, name: props.country }];
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [props.timeZone];
  return (
    <section class="card card-pad stack" aria-label={t`Language and region`}>
      <Field label={t`Default language`} hint={t`For everyone who has not chosen a language, and for messages outside the app.`}>
        {(id) => (
          <select id={id} class="select" value={props.locale} onChange={(e) => props.onLocale((e.target as HTMLSelectElement).value as Locale)}>
            {LOCALES.map((l) => (
              <option value={l}>{LOCALE_NAMES[l]}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t`Country`}>
        {(id) => (
          <select id={id} class="select" value={props.country} onChange={(e) => props.onCountry((e.target as HTMLSelectElement).value)}>
            {countries.map((c) => (
              <option value={c.code}>{c.name}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t`State or region`} hint={t`For school holidays and public holidays.`}>
        {(id) => (
          <select id={id} class="select" value={props.subdivision} onChange={(e) => props.onSubdivision((e.target as HTMLSelectElement).value)}>
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
          <select id={id} class="select" value={props.timeZone} onChange={(e) => props.onTimeZone((e.target as HTMLSelectElement).value)}>
            {zones.map((z) => (
              <option value={z}>{z.replaceAll("_", " ")}</option>
            ))}
          </select>
        )}
      </Field>
    </section>
  );
}

/**
 * Functions the club uses; switched-off modules disappear from the app and the API. The switches come from
 * the module manifests (modules/<id>/module.ts); modules made for other sports are not offered. Game
 * schedule sources (kind "fixtures") form their own group: the club may switch on several, each team picks
 * one of them.
 */
export function ModulesSection({ modules, onChange }: { modules: ClubModules; onChange: (m: ClubModules) => void }) {
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
          onChange={(v) => onChange({ ...modules, [id]: v })}
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

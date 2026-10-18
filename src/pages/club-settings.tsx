// Club profile: name, abbreviation, colours, logo, privacy notice, contact. The form is also a
// step of the setup wizard.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "preact/hooks";
import { type ClubModules, type ClubProfile, isHexColor, KABINE_SOURCE } from "../../shared/club";
import { LOCALE_NAMES, LOCALES, type Locale } from "../../shared/i18n";
import { useQuery } from "../store";
import { api, errorMessage } from "../api";
import { ClubMark, loadClub, setClub, useClub } from "../club";
import { Button, Field, Notice, SwitchRow, TextField, toast, TopBar, useDocumentTitle } from "../ui";
import { AdminOnly } from "./admin";

const LOGO_TYPES = "image/png,image/jpeg,image/webp,image/svg+xml";

export type ClubFormPart = "name" | "look" | "region" | "modules" | "privacy";
const ALL_PARTS: ClubFormPart[] = ["name", "look", "region", "modules", "privacy"];

/** The whole club profile, or some parts of it (steps of the setup wizard). Saving sends all fields. */
export function ClubProfileForm({ onSaved, submitLabel, parts = ALL_PARTS }: { onSaved?: () => void; submitLabel?: string; parts?: ClubFormPart[] }) {
  const club = useClub();
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
  const [defaultLocale, setDefaultLocale] = useState<Locale>(club.defaultLocale);
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

/** Functions the club uses; switched-off modules disappear from the app and the API. */
export function ModulesSection({ modules, onChange }: { modules: ClubModules; onChange: (m: ClubModules) => void }) {
  const set = (patch: Partial<ClubModules>) => onChange({ ...modules, ...patch });
  return (
    <section class="card card-pad stack-sm" aria-label={t`Modules`}>
      <h2 class="section-title" style={{ margin: 0 }}>
        <Trans>Modules</Trans>
      </h2>
      <SwitchRow
        label={t`Helper duties`}
        sub={t`Parents or players sign up for duties at games and special events (cake, timekeeping, washing shirts).`}
        checked={modules.duties}
        onChange={(v) => set({ duties: v })}
      />
      <SwitchRow
        label={t`Youth referees`}
        sub={t`Home games of the marked age groups get a youth referee duty, with a role granted by link. Needs helper duties.`}
        checked={modules.youthReferees}
        disabled={!modules.duties}
        onChange={(v) => set({ youthReferees: v })}
      />
      <SwitchRow label={t`Carpools`} sub={t`Drivers offer seats for away games, players book them.`} checked={modules.carpools} onChange={(v) => set({ carpools: v })} />
      <SwitchRow
        label={t`Game schedule from handball4all`}
        sub={t`Coaches sync the games of their team from the handball4all portal (German handball associations).`}
        checked={modules.handball4all}
        onChange={(v) => set({ handball4all: v })}
      />
      <SwitchRow
        label={t`SMS`}
        sub={t`Sign-in codes and helper plan reminders by text message, for people who enter a mobile number. Needs a provider account (costs per message).`}
        checked={modules.sms}
        onChange={(v) => set({ sms: v })}
      />
    </section>
  );
}

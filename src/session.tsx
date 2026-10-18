import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useState } from "preact/hooks";
import type { Me, SessionResponse } from "../shared/types";
import { api, errorMessage } from "./api";
import { refreshBadge, setBadge } from "./badge";
import { clearOfflineData } from "./offline";
import { clearCache } from "./store";

interface SessionState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState>({
  me: null,
  loading: true,
  refresh: async () => null,
  logout: async () => {},
});

export function SessionProvider({ children }: { children: ComponentChildren }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<SessionResponse>("/session");
      const next = res.authenticated ? res.me : null;
      setMe(next);
      if (next) refreshBadge();
      else setBadge(0);
      return next;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    clearCache();
    await clearOfflineData();
    setBadge(0);
    setMe(null);
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => {
      setMe(null);
      void clearOfflineData();
    };
    const onOnline = () => void refresh();
    window.addEventListener("kabine:online", onOnline);
    window.addEventListener("kabine:unauthorized", onUnauthorized);
    // Beim Zurückkehren in die App Session prüfen (gleitende Verlängerung).
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("kabine:unauthorized", onUnauthorized);
      window.removeEventListener("kabine:online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return <SessionContext.Provider value={{ me, loading, refresh, logout }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}

export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error("Nicht angemeldet");
  return me;
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

// iOS startet den Passkey-Dialog nur, solange die Erlaubnis aus dem Tippen
// noch gilt. Eine Netzwerkanfrage zwischen Tippen und Dialog kann sie aufbrauchen,
// besonders in der installierten App. Deshalb liegen die Optionen vorher bereit
// und bleiben nach einem Abbruch für den nächsten Versuch erhalten.

interface Prepared<T> {
  key: string;
  challengeId: string;
  options: T;
  at: number;
}

/** Challenges gelten auf dem Server 5 Minuten. */
const PREPARED_MAX_AGE_MS = 4 * 60_000;

let preparedLogin: Prepared<PublicKeyCredentialRequestOptionsJSON> | null = null;
let preparedRegistration: Prepared<PublicKeyCredentialCreationOptionsJSON> | null = null;

function fresh<T>(prepared: Prepared<T> | null, key: string): Prepared<T> | null {
  return prepared && prepared.key === key && Date.now() - prepared.at < PREPARED_MAX_AGE_MS ? prepared : null;
}

async function fetchLoginOptions(): Promise<Prepared<PublicKeyCredentialRequestOptionsJSON>> {
  const res = await api.post<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>("/auth/login/options");
  preparedLogin = { key: "login", ...res, at: Date.now() };
  return preparedLogin;
}

/** Login-Optionen vorab holen, z. B. beim Öffnen der Anmeldeseite. */
export async function prepareLogin(): Promise<void> {
  await fetchLoginOptions().catch(() => undefined);
}

/** Passkey-Login. Muss aus einem Tippen heraus aufgerufen werden. */
export async function loginWithPasskey(): Promise<void> {
  const ready = fresh(preparedLogin, "login");
  const prepared = ready ?? (await fetchLoginOptions());
  let response;
  try {
    response = await startAuthentication({ optionsJSON: prepared.options });
  } catch (err) {
    reportPasskeyError("login", err, ready ? Date.now() - ready.at : null);
    throw err;
  }
  preparedLogin = null;
  await api.post("/auth/login/verify", { challengeId: prepared.challengeId, response });
}

async function fetchRegistrationOptions(base: string, body: Record<string, unknown>): Promise<Prepared<PublicKeyCredentialCreationOptionsJSON>> {
  const res = await api.post<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>(`${base}/options`, body);
  preparedRegistration = { key: `${base} ${JSON.stringify(body)}`, ...res, at: Date.now() };
  return preparedRegistration;
}

/** Registrierungsoptionen vorab holen, sobald feststeht, für wen der Passkey ist. */
export async function prepareRegistration(base: string, body: Record<string, unknown>): Promise<void> {
  await fetchRegistrationOptions(base, body).catch(() => undefined);
}

/** Passkey-Registrierung über ein Endpunktpaar …/options und …/verify. */
export async function registerPasskey(base: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ready = fresh(preparedRegistration, `${base} ${JSON.stringify(body)}`);
  const prepared = ready ?? (await fetchRegistrationOptions(base, body));
  let response;
  try {
    response = await startRegistration({ optionsJSON: prepared.options });
  } catch (err) {
    reportPasskeyError("register", err, ready ? Date.now() - ready.at : null);
    throw err;
  }
  preparedRegistration = null;
  return api.post<Record<string, unknown>>(`${base}/verify`, { challengeId: prepared.challengeId, response });
}

/** Meldet einen gescheiterten Passkey-Dialog an den Server (nur Technik, keine Personendaten). */
function reportPasskeyError(kind: "login" | "register", err: unknown, preparedAgeMs: number | null) {
  const body = {
    kind,
    name: err instanceof Error ? err.name : "unknown",
    message: err instanceof Error ? err.message.slice(0, 300) : "",
    standalone: isStandalone(),
    preparedAgeMs,
  };
  void fetch("/api/client-errors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
}

/** Technische Ursache für die Anzeige unter der Meldung. */
export function passkeyErrorDetail(err: unknown): string {
  if (!(err instanceof Error)) return "";
  const cause = (err as Error & { cause?: unknown }).cause;
  const base = cause instanceof Error ? cause : err;
  return `${base.name}: ${base.message}`;
}

/** Verständliche Meldung für Fehler aus dem Passkey-Dialog. */
export function passkeyErrorMessage(err: unknown, kind: "login" | "register"): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return kind === "login"
      ? "Das Gerät hat die Anmeldung mit dem Passkey abgelehnt oder sie wurde abgebrochen. Bitte tippe noch einmal."
      : "Der Passkey wurde nicht angelegt, weil der Dialog abgebrochen wurde. Bitte tippe noch einmal.";
  }
  if (name === "InvalidStateError") return "Auf diesem Gerät gibt es schon einen Passkey für diesen Zugang. Melde dich damit an.";
  return errorMessage(err);
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone, aber nicht Safari (Chrome, Firefox, Edge …). Passkeys landen dann evtl. nicht im iCloud-Schlüsselbund. */
export function isIosOtherBrowser(): boolean {
  return isIos() && /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(navigator.userAgent);
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

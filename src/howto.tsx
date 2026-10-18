// Anleitungen: App installieren (Browser) und Benachrichtigungen einrichten (App-Modus).
// Beide stehen dauerhaft unter Hilfe; als Hinweis auf der Startseite erscheinen sie,
// bis man sie wegklickt.
import { useEffect, useState } from "preact/hooks";
import { todayLocal } from "./format";
import { clubName } from "./club";
import { Icon } from "./icons";
import { activeMotd, MOTD, motdStorageKey } from "../shared/motd";
import { isIos, isStandalone } from "./session";

const INSTALL_DISMISSED = "kabine-hint-install";
const PUSH_DISMISSED = "kabine-hint-push";

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function remember(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Privater Modus: Hinweis kommt beim nächsten Mal wieder
  }
}

export function InstallSteps() {
  return isIos() ? (
    <p>
      In Safari unten auf <em>Teilen</em> tippen, dann <em>Zum Home-Bildschirm</em> und <em>Hinzufügen</em>. Danach startest du {clubName()} über das Symbol auf dem
      Home-Bildschirm. Nur so funktionieren auf dem iPhone auch Benachrichtigungen.
    </p>
  ) : (
    <p>
      Im Browsermenü <em>Zum Startbildschirm hinzufügen</em> bzw. <em>App installieren</em> wählen. Danach startest du {clubName()} über das Symbol auf dem
      Startbildschirm.
    </p>
  );
}

export function PushSteps() {
  return (
    <p>
      Unter <em>Profil</em> bei <em>Benachrichtigungen</em> auf <em>Auf diesem Gerät aktivieren</em> tippen und die Nachfrage erlauben. Mit <em>Testen</em> prüfst du,
      ob alles ankommt. Unter <em>Was soll ich bekommen?</em> wählst du die Themen.
    </p>
  );
}

/** Startseite: aktuelle Neuigkeit (shared/motd.ts), bis sie abläuft oder auf dem Gerät weggeklickt wird. */
export function MotdBanner() {
  const [motd, setMotd] = useState(() => activeMotd(MOTD, todayLocal(), (id) => read(motdStorageKey(id))));
  if (!motd) return null;
  return (
    <section class="card card-body motd" aria-label="Neuigkeit">
      <div class="row-gap">
        <Icon name="car" size={22} />
        <h2 class="section-title" style={{ margin: 0, flex: 1 }}>
          {motd.title}
        </h2>
        <button
          type="button"
          class="icon-btn"
          aria-label="Neuigkeit ausblenden"
          onClick={() => {
            remember(motdStorageKey(motd.id));
            setMotd(null);
          }}
        >
          <Icon name="x" size={20} />
        </button>
      </div>
      <p>{motd.text}</p>
    </section>
  );
}

/** Startseite im Browser: Hinweis zum Installieren als App, bis er weggeklickt wird. */
export function InstallBanner() {
  const [hidden, setHidden] = useState(() => isStandalone() || read(INSTALL_DISMISSED));
  if (hidden) return null;
  return (
    <section class="card card-body howto" aria-label="App installieren">
      <div class="row-gap">
        <Icon name="phone" size={22} />
        <h2 class="section-title" style={{ margin: 0, flex: 1 }}>
          Als App installieren
        </h2>
        <button
          type="button"
          class="icon-btn"
          aria-label="Hinweis ausblenden"
          onClick={() => {
            remember(INSTALL_DISMISSED);
            setHidden(true);
          }}
        >
          <Icon name="x" size={20} />
        </button>
      </div>
      <InstallSteps />
      <p class="small muted">Die Anleitung findest du jederzeit unter Hilfe.</p>
    </section>
  );
}

/** Push auf diesem Gerät schon eingerichtet oder abgelehnt? Dann braucht es keinen Hinweis. */
async function pushHandled(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return true;
  if (Notification.permission !== "default") return true;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

/** Startseite im App-Modus: beim ersten Start Hinweis, wie man Benachrichtigungen einrichtet. */
export function PushSetupBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!isStandalone() || read(PUSH_DISMISSED)) return;
    void pushHandled().then((handled) => {
      if (handled) remember(PUSH_DISMISSED);
      else setShow(true);
    });
  }, []);
  if (!show) return null;
  const close = () => {
    remember(PUSH_DISMISSED);
    setShow(false);
  };
  return (
    <section class="card card-body howto" aria-label="Benachrichtigungen einrichten">
      <div class="row-gap">
        <Icon name="bell" size={22} />
        <h2 class="section-title" style={{ margin: 0, flex: 1 }}>
          Benachrichtigungen einrichten
        </h2>
        <button type="button" class="icon-btn" aria-label="Hinweis ausblenden" onClick={close}>
          <Icon name="x" size={20} />
        </button>
      </div>
      <p>So erfährst du sofort von neuen Terminen, Absagen, Nominierungen und Chatnachrichten.</p>
      <PushSteps />
      <a class="btn btn-primary" href="/profil" onClick={close}>
        <Icon name="bell" size={18} />
        Zu den Benachrichtigungen
      </a>
    </section>
  );
}

// Guides: install the app (browser) and set up notifications (app mode).
// Both are always under help; as a hint on the start page they appear
// until dismissed.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "preact/hooks";
import { todayLocal } from "./format";
import { clubName } from "./club";
import { Icon, type IconName } from "./icons";
import { activeMotd, MOTD, motdStorageKey } from "../shared/motd";
import { isIos, isStandalone, useMe } from "./session";
import { enablePush, pushHandled } from "./push";
import { Button, Sheet, toast } from "./ui";
import { splashRemaining } from "./splash";
import { LOCALE_NAMES } from "../shared/i18n";
import { currentLocale } from "./i18n";

const INSTALL_DISMISSED = "kabine-hint-install";
const FIRST_STEPS_DISMISSED = "kabine-hint-first-steps";

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
    // Private mode: the hint comes back next time
  }
}

export function InstallSteps() {
  const club = clubName();
  return isIos() ? (
    <p>
      <Trans>
        In Safari, tap <em>Share</em> at the bottom, then <em>Add to Home Screen</em> and <em>Add</em>. After that you start {club} from the icon on the home
        screen. Only then do notifications work on the iPhone.
      </Trans>
    </p>
  ) : (
    <p>
      <Trans>
        In the browser menu, choose <em>Add to Home screen</em> or <em>Install app</em>. After that you start {club} from the icon on the home screen.
      </Trans>
    </p>
  );
}

export function PushSteps() {
  return (
    <p>
      <Trans>
        Under <em>Profile</em>, at <em>Notifications</em>, tap <em>Enable on this device</em> and allow the request. With <em>Test</em> you check that
        everything arrives. Under <em>What should I receive?</em> you choose the topics.
      </Trans>
    </p>
  );
}

/** Start page: current news item (shared/motd.ts), until it expires or is dismissed on the device. */
export function MotdBanner() {
  const [motd, setMotd] = useState(() => activeMotd(MOTD, todayLocal(), (id) => read(motdStorageKey(id))));
  if (!motd) return null;
  return (
    <section class="card card-body motd" aria-label={t`News`}>
      <div class="row-gap">
        <Icon name="car" size={22} />
        <h2 class="section-title" style={{ margin: 0, flex: 1 }}>
          {motd.title}
        </h2>
        <button
          type="button"
          class="icon-btn"
          aria-label={t`Hide news`}
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

/** Start page in the browser: hint on installing as an app, until dismissed. */
export function InstallBanner() {
  const [hidden, setHidden] = useState(() => isStandalone() || read(INSTALL_DISMISSED));
  if (hidden) return null;
  return (
    <section class="card card-body howto" aria-label={t`Install app`}>
      <div class="row-gap">
        <Icon name="phone" size={22} />
        <h2 class="section-title" style={{ margin: 0, flex: 1 }}>
          <Trans>Install as an app</Trans>
        </h2>
        <button
          type="button"
          class="icon-btn"
          aria-label={t`Hide hint`}
          onClick={() => {
            remember(INSTALL_DISMISSED);
            setHidden(true);
          }}
        >
          <Icon name="x" size={20} />
        </button>
      </div>
      <InstallSteps />
      <p class="small muted">
        <Trans>You can find the guide at any time under help.</Trans>
      </p>
    </section>
  );
}

/** Asked once per device. A new key, so people who closed the earlier hint card are asked once too. */
const PUSH_ASKED = "kabine-push-asked";

/**
 * Home screen: asks once per device to turn on notifications, when this device can do push but has no subscription yet.
 * Browsers show their own permission prompt only after a tap, hence this sheet first. Never again afterwards, also not
 * after "Later"; turning them on stays possible in the profile. On the iPhone push works only in the installed app, so
 * a browser tab there is never asked (the install hint covers it).
 */
export function PushPrompt() {
  const me = useMe();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (read(PUSH_ASKED) || me.viewAs || !me.vapidPublicKey) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void pushHandled().then((handled) => {
        if (!alive) return;
        if (handled) remember(PUSH_ASKED);
        else setShow(true);
      });
    }, 1500 + splashRemaining());
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);
  if (!show) return null;
  const close = () => {
    remember(PUSH_ASKED);
    setShow(false);
  };
  return (
    <Sheet open onClose={close} title={t`Turn on notifications?`}>
      <p>
        <Trans>This way you learn right away about new events, cancellations, nominations and chat messages.</Trans>
      </p>
      <p class="small muted">
        <Trans>You choose what you get at any time in your profile under notifications. You can also turn them on there later.</Trans>
      </p>
      <Button
        variant="primary"
        size="lg"
        block
        icon="bell"
        onClick={async () => {
          try {
            const permission = await enablePush(me.vapidPublicKey);
            if (permission === "granted") toast(t`Notifications are on.`);
            else if (permission === "denied") toast(t`Notifications are blocked. You can allow them in the settings of your device.`, "error");
          } finally {
            close();
          }
        }}
      >
        <Trans>Turn on</Trans>
      </Button>
      <Button variant="ghost" block onClick={close}>
        <Trans>Later</Trans>
      </Button>
    </Sheet>
  );
}

/**
 * Start page, after the install and notification hints: the remaining first steps for a new
 * account (language, picture, calendar, children), until dismissed.
 */
export function FirstStepsCard() {
  const me = useMe();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (read(FIRST_STEPS_DISMISSED)) return;
    if (!isStandalone()) {
      setShow(read(INSTALL_DISMISSED));
      return;
    }
    void pushHandled().then((handled) => setShow(handled || read(PUSH_ASKED)));
  }, []);
  if (!show) return null;
  const close = () => {
    remember(FIRST_STEPS_DISMISSED);
    setShow(false);
  };
  const language = LOCALE_NAMES[currentLocale()];
  const children = me.children.map((c) => c.firstName).join(", ");
  const rows: { href: string; icon: IconName; title: string; sub: string }[] = [
    { href: "/profil", icon: "settings", title: t`Language: ${language}`, sub: t`Change it in your profile.` },
    { href: "/profil", icon: "user", title: t`Profile picture`, sub: t`Optional. Your team sees it in the chat and in the squad.` },
    { href: "/profil", icon: "calendar", title: t`Calendar`, sub: t`Subscribe to your events in the calendar app of your phone.` },
    ...(me.children.length
      ? [{ href: "/profil", icon: "users" as IconName, title: t`Your children: ${children}`, sub: t`You respond for them and see their events here.` }]
      : []),
  ];
  return (
    <section class="card card-body howto" aria-label={t`First steps`}>
      <div class="row-gap">
        <Icon name="check" size={22} />
        <h2 class="section-title" style={{ margin: 0, flex: 1 }}>
          <Trans>First steps</Trans>
        </h2>
        <button type="button" class="icon-btn" aria-label={t`Hide hint`} onClick={close}>
          <Icon name="x" size={20} />
        </button>
      </div>
      <ul class="list">
        {rows.map((r) => (
          <li>
            <a class="list-row" href={r.href}>
              <Icon name={r.icon} size={20} />
              <span class="main">
                <span class="title">{r.title}</span>
                <span class="sub">{r.sub}</span>
              </span>
              <Icon name="chevron" size={18} />
            </a>
          </li>
        ))}
      </ul>
      <button type="button" class="btn" onClick={close}>
        <Trans>Got it</Trans>
      </button>
    </section>
  );
}

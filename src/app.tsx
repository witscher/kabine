import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ErrorBoundary, LocationProvider, Route, Router, useLocation } from "preact-iso";
import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { EnvBanner } from "./env-banner";
import { MaintenanceBanner, MaintenancePage, maintenanceIsUpdate, useIsAdmin, useMaintenance } from "./maintenance";
import { ViewAsBanner } from "./view-as";
import { OfflineBanner } from "./offline";
import { PullToRefresh, ResumeRefresh } from "./pull-refresh";
import { checkForUpdate, lazyPage, UpdateBanner } from "./update";
import { Icon, type IconName } from "./icons";
import { HomePage } from "./pages/home";
import { EventPage } from "./pages/event";
import { LoginPage } from "./pages/login";
import { JoinPage, BootstrapPage } from "./pages/join";
import { EmailLinkPage } from "./email";
import { PrivacyPage } from "./pages/privacy";
import { SessionProvider, useSession } from "./session";
import { Splash } from "./splash";
import { invalidate, useQuery } from "./store";
import { clubIsFresh, useClub } from "./club";
import { APP_MODULES, useActiveModules } from "./modules";
import { ConfirmHost, Spinner, Toasts } from "./ui";

const HelpPage = lazyPage(() => import("./pages/help").then((m) => m.HelpPage));
const SquadPage = lazyPage(() => import("./pages/squad").then((m) => m.SquadPage));
const ChatListPage = lazyPage(() => import("./pages/chat").then((m) => m.ChatListPage));
const ChatRoomPage = lazyPage(() => import("./pages/chat").then((m) => m.ChatRoomPage));
const ProfilePage = lazyPage(() => import("./pages/profile").then((m) => m.ProfilePage));
const ChildPage = lazyPage(() => import("./pages/profile").then((m) => m.ChildPage));
const NotificationsPage = lazyPage(() => import("./pages/profile").then((m) => m.NotificationsPage));
const DevicesPage = lazyPage(() => import("./pages/profile").then((m) => m.DevicesPage));
const TeamIndexPage = lazyPage(() => import("./pages/team").then((m) => m.TeamIndexPage));
const TeamPage = lazyPage(() => import("./pages/team").then((m) => m.TeamPage));
const PersonPage = lazyPage(() => import("./pages/team").then((m) => m.PersonPage));
const PlansPage = lazyPage(() => import("./pages/plans").then((m) => m.PlansPage));
const PlanEditorPage = lazyPage(() => import("./pages/plans").then((m) => m.PlanEditorPage));
const SpecialEventPage = lazyPage(() => import("./pages/special").then((m) => m.SpecialEventPage));
const AdminPage = lazyPage(() => import("./pages/admin").then((m) => m.AdminPage));
const AdminPersonsPage = lazyPage(() => import("./pages/admin").then((m) => m.AdminPersonsPage));
const AdminBroadcastPage = lazyPage(() => import("./pages/admin").then((m) => m.AdminBroadcastPage));
const AdminTeamsPage = lazyPage(() => import("./pages/admin").then((m) => m.AdminTeamsPage));
const AdminGroupsPage = lazyPage(() => import("./pages/group").then((m) => m.AdminGroupsPage));
const AdminHolidaysPage = lazyPage(() => import("./pages/admin").then((m) => m.AdminHolidaysPage));
const AdminExtraEventsPage = lazyPage(() => import("./pages/admin").then((m) => m.AdminExtraEventsPage));
const AdminAgeClassesPage = lazyPage(() => import("./pages/admin").then((m) => m.AdminAgeClassesPage));
const AdminLocationsPage = lazyPage(() => import("./pages/admin").then((m) => m.AdminLocationsPage));
const AdminClubPage = lazyPage(() => import("./pages/club-settings").then((m) => m.AdminClubPage));
const AdminMailPage = lazyPage(() => import("./pages/mail-settings").then((m) => m.AdminMailPage));
const AdminUpdatesPage = lazyPage(() => import("./pages/updates").then((m) => m.AdminUpdatesPage));
const SetupWizardPage = lazyPage(() => import("./pages/setup-wizard").then((m) => m.SetupWizardPage));
const SeasonChangePage = lazyPage(() => import("./pages/season").then((m) => m.SeasonChangePage));

const PUBLIC_PATHS = ["/einladung", "/einrichtung", "/datenschutz", "/email"];

function TabBar() {
  const { me } = useSession();
  const modules = useActiveModules();
  const { path } = useLocation();
  const rooms = useQuery<{ rooms: { unread: boolean }[] }>(me ? "/chat/rooms" : null, { refreshMs: 60_000 });
  if (!me) return null;
  const unread = rooms.data?.rooms.some((r) => r.unread) ?? false;
  const tabs: { href: string; label: string; icon: IconName; match: (p: string) => boolean; dot?: boolean }[] = [
    // Release notes or modules the admin has not seen yet: the card is on the start page (src/news.tsx)
    { href: "/", label: t`Events`, icon: "calendar", match: (p) => p === "/" || p.startsWith("/termine"), dot: !!me.news },
    { href: "/chat", label: t`Chat`, icon: "chat", match: (p) => p.startsWith("/chat"), dot: unread },
  ];
  // Tabs of the switched-on modules (modules/<id>/app, tab), e.g. the helper plan
  for (const m of modules) {
    const tab = m.tab?.(me);
    if (tab) tabs.push(tab);
  }
  if (me.isAdmin)
    tabs.push({
      href: "/verwaltung",
      label: t({ message: "Admin", context: "navigation" }),
      icon: "settings",
      match: (p) => p.startsWith("/verwaltung") || p.startsWith("/team"),
    });
  else if (me.manageableTeams.length) tabs.push({ href: "/team", label: t`Team`, icon: "users", match: (p) => p.startsWith("/team") });
  // Players and parents need no administration: help and feedback go there
  else tabs.push({ href: "/hilfe", label: t`Help`, icon: "info", match: (p) => p.startsWith("/hilfe") });
  tabs.push({ href: "/profil", label: t`Profile`, icon: "user", match: (p) => p.startsWith("/profil") });
  return (
    <nav class="tabbar" aria-label={t`Main navigation`}>
      {tabs.map((tab) => (
        <a class="tab" href={tab.href} aria-current={tab.match(path) ? "page" : undefined}>
          <Icon name={tab.icon} size={22} />
          {tab.label}
          {tab.dot ? (
            <>
              <span class="dot" aria-hidden="true" />
              <span class="sr-only">
                <Trans>(unread)</Trans>
              </span>
            </>
          ) : null}
        </a>
      ))}
    </nav>
  );
}

function ScrollTop() {
  const { path } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  return null;
}

/** Back online: reload everything visible and look for a new version. */
function OnlineRefresh() {
  useEffect(() => {
    const onOnline = () => {
      invalidate("/");
      void checkForUpdate();
    };
    window.addEventListener("kabine:online", onOnline);
    return () => window.removeEventListener("kabine:online", onOnline);
  }, []);
  return null;
}

/**
 * iOS, installed app: after the keyboard closes, fixed elements (bottom navigation bar)
 * sometimes stay shifted up by the keyboard height until the next scroll. When the visible
 * area grows clearly again, scroll minimally once and back.
 */
function KeyboardViewportFix() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let last = vv.height;
    let timer: number | undefined;
    const nudge = () => {
      const y = window.scrollY;
      window.scrollTo(window.scrollX, y > 0 ? y - 1 : 1);
      window.scrollTo(window.scrollX, y);
    };
    const onResize = () => {
      const grew = vv.height > last + 80;
      last = vv.height;
      if (!grew) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(nudge, 50);
    };
    vv.addEventListener("resize", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      window.clearTimeout(timer);
    };
  }, []);
  return null;
}

function Shell({ children }: { children: ComponentChildren }) {
  const { me, loading } = useSession();
  const { path } = useLocation();
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));
  const maintenance = useMaintenance();
  const isAdmin = useIsAdmin();
  // During an update nobody gets in, admins neither; the switch in administration lets admins through
  if (maintenance && (!isAdmin || maintenanceIsUpdate())) {
    return (
      <div class="app">
        <MaintenancePage />
      </div>
    );
  }
  if (loading && !isPublic) {
    return (
      <div class="app">
        <Spinner label={t`Loading app`} />
      </div>
    );
  }
  if (!me && !isPublic) return <LoginPage />;
  const hideTabs = isPublic || /^\/chat\/\d+/.test(path);
  return (
    <div class="app">
      <OnlineRefresh />
      <ResumeRefresh />
      <KeyboardViewportFix />
      {me ? <PullToRefresh /> : null}
      <OfflineBanner />
      <UpdateBanner />
      <ScrollTop />
      {me ? <SetupRedirect /> : null}
      {children}
      {!hideTabs ? <TabBar /> : null}
    </div>
  );
}

/**
 * Opens the setup wizard for admins as long as the setup is not finished, unless they postponed it
 * in this browser session ("Continue later").
 */
function SetupRedirect() {
  const { me } = useSession();
  const club = useClub();
  const { path, route } = useLocation();
  // Only with the profile from the server: the device's cache may still say "not set up" after the wizard
  const loaded = clubIsFresh();
  useEffect(() => {
    if (!loaded || !me?.isAdmin || club.setupDone || path !== "/") return;
    let postponed = false;
    try {
      postponed = sessionStorage.getItem("kabine.setup.later") === "1";
    } catch {
      // no storage: open the wizard
    }
    if (!postponed) route("/verwaltung/einrichtung", true);
  }, [loaded, me?.isAdmin, club.setupDone, path]);
  return null;
}

/** Old address /spiele: games are listed under events, the sync in the team. */
function RedirectHome() {
  const { route } = useLocation();
  useEffect(() => route("/", true), []);
  return null;
}

function NotFound() {
  return (
    <main class="page">
      <div class="content">
        <div class="empty">
          <div class="title">
            <Trans>Page not found</Trans>
          </div>
          <a class="btn btn-primary" href="/">
            <Trans>Go to events</Trans>
          </a>
        </div>
      </div>
    </main>
  );
}

export function App() {
  return (
    <LocationProvider>
      <SessionProvider>
        <EnvBanner />
        <MaintenanceBanner />
        <ViewAsBanner />
        <ErrorBoundary>
          <Shell>
            <Router>
              <Route path="/" component={HomePage} />
              {/* Pages of the modules (modules/<id>/app, routes) */}
              {APP_MODULES.flatMap((m) => m.routes ?? []).map((r) => (
                <Route key={r.path} path={r.path} component={r.page} />
              ))}
              <Route path="/termine/:id" component={EventPage} />
              <Route path="/spiele" component={RedirectHome} />
              <Route path="/spiele/:id/kader" component={SquadPage} />
              <Route path="/chat" component={ChatListPage} />
              <Route path="/chat/:teamId" component={ChatRoomPage} />
              <Route path="/profil" component={ProfilePage} />
              <Route path="/profil/kind/:id" component={ChildPage} />
              <Route path="/profil/benachrichtigungen" component={NotificationsPage} />
              <Route path="/profil/geraete" component={DevicesPage} />
              <Route path="/team" component={TeamIndexPage} />
              <Route path="/team/:id" component={TeamPage} />
              <Route path="/team/:id/person/:personId" component={PersonPage} />
              <Route path="/team/:id/plaene" component={PlansPage} />
              <Route path="/team/:id/plaene/:planId" component={PlanEditorPage} />
              <Route path="/team/:id/termin-neu" component={SpecialEventPage} />
              <Route path="/hilfe" component={HelpPage} />
              <Route path="/verwaltung" component={AdminPage} />
              <Route path="/verwaltung/personen" component={AdminPersonsPage} />
              <Route path="/verwaltung/rundnachricht" component={AdminBroadcastPage} />
              <Route path="/verwaltung/mannschaften" component={AdminTeamsPage} />
              <Route path="/verwaltung/gruppen" component={AdminGroupsPage} />
              <Route path="/verwaltung/ferien" component={AdminHolidaysPage} />
              <Route path="/verwaltung/altersklassen" component={AdminAgeClassesPage} />
              <Route path="/verwaltung/orte" component={AdminLocationsPage} />
              <Route path="/verwaltung/verein" component={AdminClubPage} />
              <Route path="/verwaltung/mail" component={AdminMailPage} />
              <Route path="/verwaltung/updates" component={AdminUpdatesPage} />
              <Route path="/verwaltung/saisonwechsel" component={SeasonChangePage} />
              <Route path="/verwaltung/einrichtung" component={SetupWizardPage} />
              <Route path="/verwaltung/termin-neu" component={SpecialEventPage} />
              <Route path="/verwaltung/sondertermine" component={AdminExtraEventsPage} />
              <Route path="/einladung" component={JoinPage} />
              <Route path="/email" component={EmailLinkPage} />
              <Route path="/einrichtung" component={BootstrapPage} />
              <Route path="/datenschutz" component={PrivacyPage} />
              <Route default component={NotFound} />
            </Router>
          </Shell>
        </ErrorBoundary>
        <Toasts />
        <ConfirmHost />
        <Splash />
      </SessionProvider>
    </LocationProvider>
  );
}

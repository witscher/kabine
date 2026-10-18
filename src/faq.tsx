// Frequently asked questions under help. Everyone sees the sections of their role; coaches and admins
// see all of them, so they can answer questions from players and parents.
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ComponentChildren } from "preact";
import { Icon } from "./icons";
import { useMe } from "./session";

interface Faq {
  q: string;
  a: ComponentChildren;
}

const all = (): Faq[] => [
  {
    q: t`I have a new phone and can no longer get into the app.`,
    a: (
      <>
        <p>
          <Trans>
            If the new phone is signed in with the same Apple or Google account, your passkey is usually already there: just <em>Sign in with passkey</em>.
          </Trans>
        </p>
        <p>
          <Trans>
            If that does not work and you have stored an e-mail address, use <em>Code by e-mail</em>. Otherwise your coach sends you a personal link (valid for 7
            days, single use) to set up a new passkey. For children, the parents can also do this under <em>Profile → Child</em>.
          </Trans>
        </p>
      </>
    ),
  },
  {
    q: t`How do I install the app on my phone?`,
    a: (
      <p>
        <Trans>
          On the iPhone, tap <em>Share</em> at the bottom in Safari and then <em>Add to Home Screen</em>; on Android, choose <em>Install app</em> in the browser
          menu. The guides further down explain it step by step.
        </Trans>
      </p>
    ),
  },
  {
    q: t`Why can't I install the app from the App Store?`,
    a: (
      <p>
        <Trans>
          The app belongs to our club only and runs on its own address. If it were in the App Store, the whole world would have access to the app. That is
          unnecessary and we do not want it either.
        </Trans>
      </p>
    ),
  },
  {
    q: t`How do I get my events into my calendar?`,
    a: (
      <p>
        <Trans>
          Under <em>Profile → My events</em> you choose training, games and helper duties and tap <em>Subscribe in calendar</em>. The events then appear in your
          phone's calendar app and stay up to date by themselves. Do not pass the link on.
        </Trans>
      </p>
    ),
  },
  {
    q: t`I don't get any notifications.`,
    a: (
      <p>
        <Trans>
          Under <em>Profile → Notifications</em>, tap <em>Enable on this device</em> and allow it, then check with <em>Test</em>. On the iPhone this only works in
          the installed app (from iOS 16.4), not in the browser. You also choose there which topics you receive.
        </Trans>
      </p>
    ),
  },
  {
    q: t`What is a passkey and is it safe?`,
    a: (
      <p>
        <Trans>
          You sign in with Face ID, fingerprint or your screen lock, without a password. This is safer than a password because it cannot be guessed or
          intercepted. The app never sees any biometric data.
        </Trans>
      </p>
    ),
  },
  {
    q: t`Who sees my reasons for declining?`,
    a: (
      <p>
        <Trans>
          Only the team's coaches and the admins. Other players and parents only see how many have accepted or declined. The reason is deleted 60 days after the
          event.
        </Trans>
      </p>
    ),
  },
  {
    q: t`What data does the app store about me?`,
    a: (
      <p>
        <Trans>
          First name, last name and year of birth, plus optionally an e-mail address and a profile picture. Also your responses, helper duties and chat
          messages. More on this in the <a href="/datenschutz">privacy notice</a>.
        </Trans>
      </p>
    ),
  },
];

const players = (): Faq[] => [
  {
    q: t`Do I have to accept every training?`,
    a: (
      <p>
        <Trans>No. You are in automatically. You only decline if you cannot come.</Trans>
      </p>
    ),
  },
  {
    q: t`Until when can I decline?`,
    a: (
      <p>
        <Trans>
          Until the deadline for declining, usually 6 hours before the start. The exact deadline is shown in the event. After that it is still possible, but
          counts as short notice, and your coach gets a message. You always need a reason.
        </Trans>
      </p>
    ),
  },
  {
    q: t`My name is missing from the invitation link or is already taken.`,
    a: (
      <p>
        <Trans>Tell your coach. They will add you or check who signed up with your name.</Trans>
      </p>
    ),
  },
  {
    q: t`I am injured for a longer time or can never make it on a certain weekday.`,
    a: (
      <p>
        <Trans>
          Tell your coach. They will set you inactive or away long-term for this weekday. Then you do not have to decline each time and you get no reminders.
        </Trans>
      </p>
    ),
  },
  {
    q: t`What does “absent without excuse” mean?`,
    a: (
      <p>
        <Trans>You did not decline and still were not there. The coach enters this after the event. Only you, your parents and the coaches can see it.</Trans>
      </p>
    ),
  },
  {
    q: t`Why does my profile picture not appear right away?`,
    a: (
      <p>
        <Trans>For minors, the parents approve the picture. Until then only you and your parents see it.</Trans>
      </p>
    ),
  },
];

const parents = (): Faq[] => [
  {
    q: t`How does my child get their own access?`,
    a: (
      <p>
        <Trans>
          Under <em>Profile → your child</em>, tap <em>Set up access for …</em>. Give the link (valid for 7 days, single use) only to your child or open it
          directly on their phone. If your child has a new phone, create a <em>Link for new passkey</em> there. This works in teams where parents are involved.
        </Trans>
      </p>
    ),
  },
  {
    q: t`I have children in different teams.`,
    a: (
      <p>
        <Trans>
          First sign in with your existing access and then open the parent link of the other team. There you link the child to your access. A second access is
          not needed.
        </Trans>
      </p>
    ),
  },
  {
    q: t`Can the second parent take part too?`,
    a: (
      <p>
        <Trans>Yes, via the same parent link of the team with their own access. Two parents can be linked per child.</Trans>
      </p>
    ),
  },
  {
    q: t`Does my child decline themselves or do I?`,
    a: (
      <p>
        <Trans>
          Both are possible, the latest response counts. You each see who answered. What your child may do themselves (accept, decline, chat) you set under{" "}
          <em>Profile → your child</em>. In teams without parent involvement, usually the older ones, the child handles everything themselves.
        </Trans>
      </p>
    ),
  },
  {
    q: t`How do I sign up in the helper plan?`,
    a: (
      <p>
        <Trans>
          In the <em>Helpers</em> tab, tap <em>Sign up</em> on the duty. Every duty has a time; tasks like washing jerseys you do before or after the event.
          Duties that need prior knowledge, such as timekeeper and secretary, are only offered to you if you switch them on under{" "}
          <em>Profile → What I can do</em>. You can subscribe to your duties in your calendar under <em>Profile → My events</em>.
        </Trans>
      </p>
    ),
  },
  {
    q: t`I don't want to receive chat messages.`,
    a: (
      <p>
        <Trans>
          In the team chat you can <em>Leave the chat</em> via the menu and rejoin later. To switch off only the push notifications, go to{" "}
          <em>Profile → Notifications</em>.
        </Trans>
      </p>
    ),
  },
];

const coaches = (): Faq[] => [
  {
    q: t`How do players and parents get into the app?`,
    a: (
      <p>
        <Trans>
          Under <em>Team → Invitations</em>, create the player or parent link and send it to the team's WhatsApp group. There everyone chooses their name or
          their child.
        </Trans>
      </p>
    ),
  },
  {
    q: t`A player or parent can no longer get into the app.`,
    a: (
      <p>
        <Trans>
          Open the person in the squad and create a <em>Link for new passkey</em> (or <em>Personal invitation link</em>). Send the link only directly to this
          person, it is valid for 7 days and single use.
        </Trans>
      </p>
    ),
  },
  {
    q: t`How do I nominate the squad for a game?`,
    a: (
      <p>
        <Trans>
          In the game, tap <em>Nominate squad</em>, select and publish. If people are missing, you get players from other teams via <em>Request help</em>. With{" "}
          <em>Set core squad</em> (Team → Squad) and the switch <em>Automatically nominate the core squad for all games</em> (Team → Settings), the core squad is
          nominated in advance for all games.
        </Trans>
      </p>
    ),
  },
  {
    q: t`A player should also play in the second team.`,
    a: (
      <p>
        <Trans>
          In the squad, tap <em>Add → From another team</em> and add the person. They then play in both teams and see joint training sessions only once.
        </Trans>
      </p>
    ),
  },
  {
    q: t`Cancel or move training, or pause it during the holidays.`,
    a: (
      <p>
        <Trans>
          In the training, tap <em>Cancel</em> or <em>Move</em>, everyone gets a message. For holidays, go to <em>Team → Training plans</em> and choose{" "}
          <em>Training break</em> or a separate <em>Holiday plan</em> for the holidays.
        </Trans>
      </p>
    ),
  },
  {
    q: t`How do I update the game schedule?`,
    a: (
      <p>
        <Trans>
          Under <em>Team → Settings → Schedule</em>, tap <em>Sync now</em>. The app only fetches the schedule from handball4all at the push of a button, never
          automatically. Moved games are then announced to everyone.
        </Trans>
      </p>
    ),
  },
  {
    q: t`Decline for a player or record “absent without excuse”.`,
    a: (
      <p>
        <Trans>
          Tap the name in the event. Before the event you can decline or accept again for them there. After the start the switch{" "}
          <em>Absent without excuse</em> appears. You find past events under <em>Events → Past</em>.
        </Trans>
      </p>
    ),
  },
  {
    q: t`Inactive or away long-term: what is the difference?`,
    a: (
      <p>
        <Trans>
          <em>Inactive</em> applies to all events, for example during an injury or a stay abroad. <em>Away long-term</em> applies only to a certain training
          time, for example every Tuesday. In both cases nobody has to decline and there are no reminders.
        </Trans>
      </p>
    ),
  },
  {
    q: t`What is the difference between a group and a team?`,
    a: (
      <p>
        <Trans>
          A <em>group</em> only has a chat and special events with responses, for example the coaching team. Training, games, squad, helper plan and parents only
          exist for teams. Whoever is responsible for a group creates special events under <em>Team</em> and moderates the chat. An admin assigns members.
        </Trans>
      </p>
    ),
  },
  {
    q: t`Change helper slots or create a game without handball4all.`,
    a: (
      <p>
        <Trans>
          In the <em>Helpers</em> tab, on the card <em>Manage</em>: change time and slots per duty (0 hides it), add or remove a time block, sign someone up or
          hide the game. Friendlies, tournaments or match days without handball4all you create under <em>Team → Create event → Game</em>, the team then gets a
          message.
        </Trans>
      </p>
    ),
  },
  {
    q: t`Which duties are there at our games, and how does a special event get helpers?`,
    a: (
      <p>
        <Trans>
          The duties of a game come from a template. Under <em>Team → Settings → Helper plan</em> you choose the template for home and away games; admins
          maintain templates and duty types under <em>Admin → Helper duties</em>. For a special event, switch on <em>Helpers needed</em> and create time blocks,
          also a separate duty just for this event, for example barbecue. For an existing special event this is done in the event under{" "}
          <em>Helpers: add time block</em>. There, under <em>Organisers</em>, you also add further people who help manage the helper duties.
        </Trans>
      </p>
    ),
  },
];

function Section(props: { title: string; items: Faq[] }) {
  const title = props.title;
  return (
    <section class="stack-sm" aria-label={t`Frequently asked questions: ${title}`}>
      <h3 class="faq-group">{props.title}</h3>
      {props.items.map((f) => (
        <details class="card howto-fold faq">
          <summary>
            <span>{f.q}</span>
            <Icon name="chevron" size={18} />
          </summary>
          <div class="card-body">{f.a}</div>
        </details>
      ))}
    </section>
  );
}

export function FaqList() {
  const me = useMe();
  const isCoach = me.isAdmin || me.manageableTeams.length > 0;
  const isPlayer = me.memberships.some((m) => m.role === "player" || m.role === "helper");
  const isParent = me.children.length > 0;
  return (
    <section class="stack" aria-label={t`Frequently asked questions`}>
      <h2 class="section-title">
        <Trans>Frequently asked questions</Trans>
      </h2>
      <Section title={t`For everyone`} items={all()} />
      {isPlayer || isCoach ? <Section title={t`Players`} items={players()} /> : null}
      {isParent || isCoach ? <Section title={t`Parents`} items={parents()} /> : null}
      {isCoach ? <Section title={t`Coaches`} items={coaches()} /> : null}
    </section>
  );
}

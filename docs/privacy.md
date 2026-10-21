# Privacy and youth protection

Kabine is used mostly by children and teenagers and their parents. It is built to store as little as possible, to show it to as few people as possible, and to keep it inside the club. This page describes what the app stores, who sees it and when it is deleted. It helps the club write its privacy policy and keep its records of processing. It is not legal advice; the club remains responsible.

## Principles

- **One club, one installation.** The data lives in the club's own Cloudflare account. There is no central Kabine server, no shared database between clubs, and the authors of Kabine have no access.
- **Only what a team needs.** Of players and parents: first name, last name and, for players, the year of birth. No address, no date of birth, no phone number (unless someone enters one for text messages), no photos unless someone uploads a profile picture.
- **Invitations only.** There is no public sign-up and no public page with content. People join through links their coach shares with the team.
- **No tracking.** No analytics, no advertising, no third-party scripts, fonts or images at runtime. The app loads everything from the club's own address.
- **Reasons stay with the coaches.** Why someone declines is visible to coaches and admins only, and deleted 60 days after the event.

## Youth protection

- **Parents are in charge of minors.** When a team includes parents, a parent links to the child's profile and decides what the child may do in the app: accept, decline, read the team chat, write in it, answer stand-in requests. Each switch is logged (who changed it, when). Teams of older players or adults can do without parents.
- **Profile pictures need parental approval.** A picture a minor uploads is only visible to others once a parent approves it. Pictures are optional, visible only to people signed in, and deleted when the person leaves the club.
- **Chat with supervision.** Team chats always include the coaches. Coaches can mute a member and delete messages. Parents read along in the chats of their children's teams unless they opt out. There are no private messages between members.
- **Names are shortened where others see them.** Helper duties and carpools show "First name L." to the other parents and players. Full names are visible to coaches and admins.
- **Leaving is complete.** When someone leaves the club, sign-ins, passkeys, push subscriptions, the profile picture and future responses are removed at once; the person and their history are deleted at the next season change at the latest. Chat histories are deleted at every season change.

## Data inventory

| Data | Of whom | Purpose | Visible to | Deleted |
| --- | --- | --- | --- | --- |
| First name, last name | Everyone | Identify people in the team | Signed-in members of the same team, shortened where noted above | When leaving, at the next season change at the latest |

Only admins change their own name; players, parents and coaches ask their coach or an admin, who correct it (right to rectification, Art. 16 GDPR). So everyone knows who is who, and children cannot rename themselves.

| Year of birth | Players | Age group and team assignment | Coaches, admins | As above |
| Team memberships, roles | Everyone | Who sees which events and chats | Team members (coaches and admins in full) | When leaving; at the season change teams are assigned again |
| Parent–child link, child permissions with log | Parents, minors | Parents act for their children | The parent, coaches and admins | When leaving |
| Responses (yes/no, late) | Players | Planning trainings and games | Coaches, admins; team staff and, if the team switches it on, the team (without reasons) | At the season change |
| Decline reasons | Players | Planning | Coaches, admins | 60 days after the event |
| "I'm not there" of coaches, leads, staff and organisers, with an optional note | Leaders of the event | Planning, stand-ins | That someone is not there: everyone who sees the event. The note: coaches and admins of the event | Note 60 days after the event, the entry with the event at the season change |
| Attendance after an event (present, excused, unexcused), attendance statistics | Players | Overview for coaches | Coaches, admins; the player and their parents see their own entry | Event data at the season change; season totals stay with the person until they leave |
| Squad nominations | Players | Games | Team | At the season change |
| Helper duties | Parents, players | Duties at games and events | Helpers of the team ("First name L."), coaches | At the season change |
| Carpools | Drivers, riders | Away games | Nominated players and their parents ("First name L."), coaches | At the season change |
| Chat messages, reactions | Members | Team communication | Team chat members | At the season change |
| E-mail address | Everyone who enters one | Sign-in codes, access links; helper plan mails and feedback replies only if chosen | Nobody in the app; admins only in the data export | When leaving |
| Mobile number (SMS module) | Everyone who enters one | Sign-in codes and reminders by SMS | Nobody | On request in the profile, when leaving |
| Profile picture | Who uploads one | Recognising each other | Signed-in members; for minors after parental approval | On request, when leaving |
| Passkeys | Everyone with access | Sign-in (public key only, no biometrics) | Nobody | When removed in the profile, when leaving |
| Sign-ins (sessions) with device type | Everyone with access | Staying signed in | The person (device list) | Expire 30 days after last use, 90 days after sign-in; removed when leaving |
| Push subscriptions | Devices with notifications on | Notifications | Nobody | When switched off, when leaving |
| Day of last use | Everyone with access | Spotting unused accesses | Admins | When leaving |
| Personal calendar link | Who creates one | Calendar subscription | The person | When reset, when leaving |
| "Full member" marker | Adults | Who may organise events and take certain duties | Admins | When leaving |

Content cached on devices for offline use is deleted when the person signs out.

## Who processes data for the club

- **Cloudflare** runs the app and stores the database (Workers, D1, KV, Durable Objects, Queues). The club concludes Cloudflare's data processing agreement in its account. To keep the data in the EU, create the database by hand with `npx wrangler d1 create kabine --jurisdiction eu` (see the manual installation in `docs/install.md`).
- **Push services** of the device makers (Apple, Google, Mozilla, Microsoft) deliver notifications. The content is end-to-end encrypted; the push service sees only the device address.
- **E-mail:** Cloudflare Email Sending or the club's own mail server.
- **SMS (optional):** the provider the club chooses (currently seven.io).
- **OpenHolidays API:** the app fetches school and public holidays for the club's region. No personal data is sent.
- **handball4all (optional):** a coach's or admin's device fetches the game schedule directly from the association's service. No personal data is sent.

## Template for the club's privacy policy

The following section can be added to the club's privacy policy and adapted. The app's own privacy page (*Profile → Privacy*) shows the details above to everyone and links to the club's policy.

> **Team app "[name of the app]"**
>
> For training, games and team communication the club runs a team app at [address]. The app is used by players, their parents and the coaches of the club. Access is by invitation of the coaches only.
>
> We process: first name, last name and year of birth of players; first name and last name of parents and coaches; team memberships; responses to events and, if given, reasons for declining; squad nominations; helper duties and carpools; messages in the team chats; optionally an e-mail address, a mobile number and a profile picture. Technically necessary are passkeys (public keys), sign-ins and push subscriptions of the devices.
>
> Purpose is the organisation of the club's sports operations (Art. 6(1)(b) GDPR, membership relationship) and, for optional data such as profile pictures and e-mail addresses, consent (Art. 6(1)(a) GDPR), for minors given by their parents. Reasons for declining are deleted 60 days after the event, responses, chats and events at the end of each season, all data of a person when they leave the club, at the latest at the next season change.
>
> The app runs on the infrastructure of Cloudflare, Inc. as processor ([data processing agreement]). Notifications are delivered through the push services of the device manufacturers. [If used: Text messages are sent through [provider].] There is no tracking and no advertising.
>
> Contact for questions about the app: [name, e-mail].

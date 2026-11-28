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
- **Limits per age group and team.** Admins set per youth age group what children may do in the app at most: their own access, responding, the chat (none, read, write), stand-in requests. Coaches can restrict this further for their team, for example a chat with parents only. Parents decide within these limits. Without an own access there is no player link; the parents respond and are in the chat. This stores no additional personal data.
- **Profile pictures need parental approval.** A picture a minor uploads is only visible to others once a parent approves it. Pictures are optional, visible only to people signed in, and deleted when the person leaves the club.
- **Chat with supervision.** Team chats always include the coaches. Coaches can mute a member and delete messages. Parents read along in the chats of their children's teams unless they opt out. There are no private messages between members.
- **Names are shortened where others see them.** Helper duties, carpools and scheduling polls show "First name L." to the other parents and players. Full names are visible to coaches and admins. In other polls and in orders participants see no names at all, only their own order.
- **Rights apply at once.** When someone is removed from a team, leaves the club, loses a parent link, admin rights or a device, or parents switch off the chat for their child, chats that are open right now close and reopen only with the rights that are left.
- **Leaving is complete.** When someone leaves the club, sign-ins, passkeys, push subscriptions, the profile picture and future responses are removed at once; the person and their history are deleted at the next season change at the latest. Chat histories are deleted at every season change.

## Data inventory

| Data | Of whom | Purpose | Visible to | Deleted |
| --- | --- | --- | --- | --- |
| First name, last name | Everyone | Identify people in the team | Signed-in members of the same team, shortened where noted above | When leaving, at the next season change at the latest |

Only admins change their own name; players, parents and coaches ask their coach or an admin, who correct it (right to rectification, Art. 16 GDPR). So everyone knows who is who, and children cannot rename themselves.

| Year of birth | Players | Age group and team assignment; helper duties marked "adults only" are not offered to anyone under 18 by it | Coaches, admins | As above |
| Team memberships, roles | Everyone | Who sees which events and chats | Team members (coaches and admins in full) | When leaving; at the season change teams are assigned again |
| Parent–child link, child permissions with log | Parents, minors | Parents act for their children | The parent, coaches and admins | When leaving |
| Responses (yes/no, late) | Players | Planning trainings and games | Coaches, admins; team staff and, if the team switches it on, the team (without reasons) | At the season change |
| Decline reasons | Players | Planning | Coaches, admins | 60 days after the event |
| Special events with optional attendance: who said yes | Players, parents | Organisers book for those who come | As responses; also the event's organisers ("First name L.", never reasons) | With the event at the season change |
| Special events with registration per family: how many people a family brings, who changed it last | Players, parents | Organisers plan the number of guests | The family itself; coaches, admins and the event's organisers (families as "Kim, Lea and Mona K." with their number) | With the event at the season change |
| "I'm not there" of coaches, leads, staff and organisers, with an optional note | Leaders of the event | Planning, stand-ins | That someone is not there: everyone who sees the event. The note: coaches and admins of the event | Note 60 days after the event, the entry with the event at the season change |
| Attendance after an event (present, excused, unexcused), attendance statistics | Players | Overview for coaches | Coaches, admins (team statistics with names); the player and their parents see their own entry and their own counts (*My statistics*), never other people's; parents in charge get a push at once when their child is marked unexcused | Event data at the season change; season totals stay with the person until they leave |
| Squad nominations | Players | Games | Team | At the season change |
| Game schedule from a source (handball4all, handball.net): games, halls and results of the team's league, for each game how often the app tried to fetch its result by itself (a number and a time), and the league table of the last sync (position, team name, games, goals, points of each team in the league, the source's note); public data of the source, no personal data | The club's teams | Games in the app; the table on the game page | The games: as any event; the table: everyone who sees the game (also its fans) | Games and tables at the season change; a table also when the team's source changes, and the next sync replaces it; the tables are not in the export |
| Helper duties | Parents, players | Duties at games, events and club events; for a duty, which teams its helpers come from (no personal data) | Helpers of the team ("First name L."), coaches; helpers from other teams named for the duty; at club events everyone in the club | At the season change |
| Protocol of actions with a large effect: who removed an access, created a personal link (and that it was used on an existing access, with a new e-mail address shortened to its first two characters and its domain), recorded a leaving, deleted a person, granted or took admin rights, added or removed members, set someone inactive, changed a parent link, linked a game schedule or synced it with changes, cancelled or deleted an event, deleted a team, changed the season, downloaded the export; with the names of those involved as they were then | Admins, coaches, the people concerned | Traceability in a club that trusts its coaches; not everyday things such as responses, squads, chats or helper duties | Admins only | At the season change (then only the season change itself remains); not in the export |
| Approvals for duties that need prior knowledge ("I can do this" in the profile, or approved by an admin, e.g. youth referee, also for children) | Parents, players | Only suitable people are offered such a duty | The person and their parents, admins; coaches when they sign someone up | When taken back (by the person or an admin), when leaving the club |
| Carpools | Drivers, riders | Away games | Nominated players and their parents ("First name L."), coaches | At the season change |
| Polls module: who may vote and what each person or family answered; for orders the items and quantities, an order number, the amount and whether it was reported or confirmed as paid (with who reported it and when); product photos of the items (no people) | Players, parents, coaches asked in a poll | Asking a team or the club, collecting orders and payments | Creator, coaches of the team, admins (names unless the poll is anonymous; for them also last names and the players' other teams); in scheduling polls also the participants ("First name L."); orders: each family only its own. Creator, coaches and admins can download the orders as an Excel file (names, teams, items, amounts, payment state); the app builds it on their device from what they already see, nothing is sent anywhere, and the club is responsible for the copy | With the poll, at the latest at the season change; someone who leaves the club is removed from running polls; not in the export |
| Fans module: which teams an access follows, whether only home games, whether the games go into the personal calendar | Every access, for itself | Seeing the games of other teams of the club, a push when one is moved or cancelled at short notice | Only the person themselves; nobody else sees whom someone follows. Followers see only game data of those teams (start, venue, opponent, result, cancellation), no squad, responses, names or reasons | When the person unfollows or switches it off, leaves the club, or the team or access is deleted; stays over the season change; in the export, except the calendar choice |
| Home game day module: the settings, the days on which the message the day before went out (a date); no personal data | The club | Telling everyone involved the day before that many teams play at home | The overview of the day: players, parents, coaches and fans of the teams that play, whoever has a helper duty that day, admins; game data only (start, venue, opponent), no squads, responses or names. Who gets the message is worked out when it is sent and not stored | The dates after a week; not in the export |
| Club mascot module: up to six pictures of the club's mascot (faces for results, pictures for the home game day), uploaded by an admin; no personal data | The club | Showing the mascot next to results and on the home game day | Everyone who opens the app, like the club logo | When an admin removes or replaces a picture; not in the export |
| Payment details for orders (polls module): PayPal.me name, account holder and IBAN of the club | The club (the account holder may be a person, e.g. the treasurer) | Paying orders | Admins and coaches; everyone who ordered | When an admin removes them |
| Chat messages, reactions | Members | Team communication | Team chat members | At the season change |
| E-mail address | Everyone who enters one | Sign-in codes, access links; helper plan mails and feedback replies only if chosen | Nobody in the app; admins only in the data export | When leaving |
| Requests for a sign-in code with an address or number that belongs to no access: a keyed hash of it, no code, nothing is sent | Whoever types such an address on the sign-in page | The same limit of requests for every address, so the limit does not show who is in the club | Nobody | After one day |
| Feedback (*Help and feedback*): the text, an optional picture, name and roles of the sender, and the e-mail address if a reply is wanted; sent by e-mail, not stored in the app | Who sends feedback | Improving the app, answering questions | The recipient of the mail: the owner of the installation, or the address set as `FEEDBACK_TO` | In the app: not stored; a count per access (at most 10 a day) in KV for one day. The mail: as the recipient keeps it |
| Requests for sign-in codes per network address: a keyed hash of the IP address (IPv6: of its first half, the /64 prefix) with the request in the database, at most 20 an hour | Whoever requests a sign-in code | Slowing down mass requests | Nobody | The hash after one to two hours (hourly clean-up), the request itself one day after the code expires |
| Unexpected server errors: time, kind (overload or error), where (path without ids and tokens, or the name of the background task) and the first 300 characters of the error message, no personal data on purpose; stored in KV, at most 20 a day | Nobody in particular | Noticing problems; from the third error of a day one e-mail to the owner of the installation | The owner (by e-mail, to the confirmed address of their access) | After 14 days |
| Mobile number (SMS module) | Everyone who enters one | Sign-in codes and reminders by SMS | Nobody | On request in the profile, when leaving |
| Profile picture | Who uploads one | Recognising each other | Signed-in members; for minors after parental approval | On request, when leaving |
| Passkeys | Everyone with access | Sign-in (public key only, no biometrics) | Nobody | When removed in the profile, when leaving |
| Sign-ins (sessions) with device type | Everyone with access | Staying signed in | The person (device list) | Expire 30 days after last use, 90 days after sign-in; removed when leaving |
| Push subscriptions | Devices with notifications on | Notifications | Nobody | When switched off, when leaving |
| Day of last use | Everyone with access | Spotting unused accesses | Admins | When leaving |
| Personal calendar link | Who creates one | Calendar subscription | The person | When reset, when leaving |
| "Full member" marker | Adults | Who may organise events and take certain duties | Admins | When leaving |

Content cached on devices for offline use is deleted when the person signs out. The app also keeps a few markers without personal data in the browser of the device (localStorage): the language, closed hints, the teams and kinds of events chosen on the start page (`kabine-home-list`, with the fans module also whether the star and the view of all games are on), whether the button for all games of the club is shown (`kabine-fans-club-button`), and whether this device was already asked once to turn on notifications (`kabine-push-asked`). They stay until they are deleted in the browser.

## Legal notice and privacy policy of the club

The club is the provider of its installation (legal notice, in Germany § 5 DDG) and the controller under the GDPR. The Kabine project is neither. Enter the links to the club's legal notice and privacy policy under *Administration → Club* (or in the last step of the setup wizard). The app shows both under every screen, puts them into the page as plain links (they work without JavaScript) and adds them under every e-mail. Admins see a warning while one is missing. There is no default: the legal pages of kabine.dev cover only the project website and the demo.

## Who processes data for the club

- **Cloudflare** runs the app and stores the database (Workers, D1, KV, Durable Objects, Queues). The club concludes Cloudflare's data processing agreement in its account. To keep the data in the EU, choose the EU jurisdiction for the D1 database when deploying with the button (by hand: `npx wrangler d1 create kabine --jurisdiction eu`, see `docs/install.md`).
- **Push services** of the device makers (Apple, Google, Mozilla, Microsoft) deliver notifications. The content is end-to-end encrypted; the push service sees only the device address.
- **E-mail:** Cloudflare Email Sending or the club's own mail server.
- **SMS (optional):** the provider the club chooses (currently seven.io).
- **OpenHolidays API:** the app fetches school and public holidays for the club's region. No personal data is sent.
- **handball4all (optional):** a coach's or admin's device fetches the game schedule (with the league table) directly from the association's service, at the press of a button, and by itself when a coach of the team opens the app: after each game until its result is there (at most twice) and once a week. No personal data is sent.
- **handball.net (optional):** a coach's or admin's device fetches the team's public game calendar directly from handball.net, at the press of a button, and by itself when a coach of the team opens the app: after each game until its result is there (at most twice) and once a week. No personal data is sent.
- **Pushes after a sync:** a moved game goes to the team (players, parents, staff) and its coaches, a game that is no longer in the schedule (it counts as cancelled) or back in it to the team and its coaches, and with the fans module to its fans when it is at most 72 hours away; new games only to the coaches. Who gets them is worked out when they are sent and not stored.

## Template for the club's privacy policy

The following section can be added to the club's privacy policy and adapted. The app's own privacy page (*Profile → Privacy*) shows the details above to everyone and links to the club's policy; the footer of every screen links the policy and the legal notice directly.

> **Team app "[name of the app]"**
>
> For training, games and team communication the club runs a team app at [address]. The app is used by players, their parents and the coaches of the club. Access is by invitation of the coaches only.
>
> We process: first name, last name and year of birth of players; first name and last name of parents and coaches; team memberships; responses to events and, if given, reasons for declining; squad nominations; helper duties and carpools; answers and orders in polls (if the club uses them); messages in the team chats; optionally an e-mail address, a mobile number and a profile picture. Technically necessary are passkeys (public keys), sign-ins and push subscriptions of the devices.
>
> Purpose is the organisation of the club's sports operations (Art. 6(1)(b) GDPR, membership relationship) and, for optional data such as profile pictures and e-mail addresses, consent (Art. 6(1)(a) GDPR), for minors given by their parents. Reasons for declining are deleted 60 days after the event, responses, chats and events at the end of each season, all data of a person when they leave the club, at the latest at the next season change.
>
> The app runs on the infrastructure of Cloudflare, Inc. as processor ([data processing agreement]). Notifications are delivered through the push services of the device manufacturers. [If used: Text messages are sent through [provider].] There is no tracking and no advertising.
>
> Contact for questions about the app: [name, e-mail].

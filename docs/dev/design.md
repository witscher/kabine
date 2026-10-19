# Design decisions

The reasons behind behaviour that is not obvious from the code. Newer decisions about Kabine itself are in `docs/dev/decisions.md`.

## Sign-in and security

Sessions live in the cookie `__Host-kabine_session` (HttpOnly, Secure, SameSite=Lax). They slide for 30 days, end after 90 days at the latest, and are extended at most once a day. Unsafe requests with a foreign `Origin` are rejected as CSRF protection.

Passkeys are discoverable credentials (resident keys), so signing in needs no user name. Challenges stay in KV for five minutes.

An invitation token is an HMAC of a nonce with `APP_SECRET`. The database keeps only the nonce and a SHA-256 of the token, so a coach can show a valid link again while the database never holds it in plain text. Team links are valid for 14 days, personal one-time links for 7 days.

The first admin is set up once with a link containing `ADMIN_BOOTSTRAP_TOKEN`. On a fresh installation that page asks for the admin's name and e-mail address; after the first use the endpoint answers 410.

Fonts and icons ship with the app. The Content Security Policy allows connections only to the app itself, to WebSockets (chat and live helper plan) and to handball4all, whose schedule is fetched in the browser (see handball4all).

## Sign-in by e-mail

One mail contains both a code and a link. The link opens in the browser, but an installed app on the iPhone has its own cookies, so there one types the code. The link token sits after `#`, so mail scanners do not fetch and use it up.

Codes and tokens are stored only as hashes, are valid for 15 minutes, can be used once and allow five wrong attempts. At most five mails per address and 20 per IP address go out per hour. The answer to a code request does not reveal whether the address is known.

Only confirmed addresses can be used to sign in, otherwise a typo could give a stranger access. Several accesses may share an address; after the code one chooses which access to use.

The e-mail address is optional on the player, parent and personal links. Whoever uses a passkey does not need one, and a lost passkey is replaced through a personal link from the coach. It is required only for signing in by code and for admins. Joining by code creates no access until the code is entered, so a wrong address locks nobody out.

The last passkey may be removed if a confirmed address exists, and the address may be removed only if a passkey exists.

Mail goes through Cloudflare Email Sending or the club's own SMTP server, set up under administration. With the SMS module, the sign-in code can also go by text message to a confirmed mobile number.

## Events and responses

Events are stored as local wall-clock time `YYYY-MM-DDTHH:MM` in the club's time zone (club profile), technical timestamps as UTC ISO strings. A small time module (`worker/lib/time.ts`) converts deadlines with `Intl`, including daylight saving changes.

Trainings are generated 70 days ahead, at most once a day (hourly cron or the first request for events). Single events that were cancelled or moved are detached from their plan and never overwritten by it.

Inactive and away long-term are derived when reading, not stored as responses. Only real accepts and declines are stored, so changes to plans and absences stay consistent without follow-up work.

A reminder goes out 24 hours before the decline deadline to everyone without a response; for games only after the squad is published. Decline reasons are deleted 60 days after the event (cron at 3 am).

## Parents

Admins link parents and children directly under Administration → People, for example to correct a wrong link. Unlike unlinking by a coach, the parent person always stays, even without a remaining child, so a correction never deletes an access.

Whether parents are involved is a switch per team ("Include parents"). New youth teams start with parents, adult teams without. Without parents, parents do not see the team's events, do not respond for their child, are not in the chat and get no push messages for that team. Parental permissions do not apply there.

For an event, the teams that count are those of the event in which the child is a member. If the child stands in for another team, its own teams count. Where there is no team (permissions, notification settings), one team with parents is enough.

Switching parents off withdraws open parent links and disconnects parents who are in the chat at that moment. The links between parents and children stay and apply again when the team is switched back; old invitation links do not come back to life.

## App updates

Every build gets an identifier that is served as `/version.json`. The app asks for it when it returns from the background and every 10 minutes while it is visible.

If the app was in the background for at least 30 seconds, it loads the new version without asking. Otherwise a note "There is a new version of the app." with a button appears at the top, so nobody is interrupted while typing.

After a deployment the lazily loaded pages of the old version no longer exist. In that case the app reloads once (guarded against loops per version) or shows a page with a "Reload" button. The service worker answers such requests with 404 instead of the app page.

## Offline

The service worker always tries the network first for API data (at most 6 seconds) and remembers the last answer. Without a network it returns that answer with the marker `x-kabine-offline`, and the app shows "You are offline. You are seeing the last loaded state." Sign-in, invitations, e-mail codes, the export and the connection check `/api/health` are never cached.

All files of the current version are listed in `/version.json` and cached after start, so pages that were never opened also work offline. Files of older versions are removed.

Returning to the app after at least a minute reloads the visible view. Pull to refresh from the very top is an own gesture, because native overscroll is off in app mode; it is not available in the chat or while a sheet is open.

The chat history comes over a WebSocket and not through the service worker, so the app keeps the last 100 messages per team itself and shows them until the connection is up. Writing does not work offline.

While offline the app checks `/api/health` every 15 seconds. Once the network is back it reloads everything visible and the session, and looks for a new version.

Only what the account may see anyway is stored, and only on the own device. Signing out or an expired session (401) deletes the stored data.

## Accept and decline

No response counts as accepted. This is not stored but computed when loading: no row in `responses` means accepted, except for inactive players, players away long-term and stand-ins. The rule applies at once to all existing events without a data migration, and new players in the squad are simply in.

Reminders still go only to those whose response is open, which leaves the stand-ins. The parental permission `may_accept` is called "Withdraw declines on their own", because that is all accepting means now.

## Automatic squad

Automatic nominations are real rows in `nominations` that the app keeps in sync: on changes to the core squad, to the setting, to the active status, when someone is removed from the team, after every schedule import and hourly in the cron. Visibility, overlap warnings and reminders then work without special cases.

Manual work wins. When a coach saves a squad by hand, the game is marked `squad_manual` and no longer synced; "Automatic again" lifts that. Switching the automatic squad off leaves squads already nominated in place. Accepted stand-in requests survive the sync.

Three days before the game, everyone nominated who has not declined gets a reminder. If a squad was just published by hand (with its own push), the reminder comes 24 hours later at the earliest.

The default squad size is 20. If the core squad is larger, the app does not cut it but shows the coach a note at the game.

## Mentions and badge count

In teams, only people who have already written in the chat and the coaches can be mentioned. A full member list of the team does not go to everyone, because otherwise only coaches and admins see names. The server checks the mentioned people against this list; one cannot mention oneself, and there are at most 10 mentions per message. Groups are different (see Groups).

`@alle` (the same word in every language, because it is part of the message text) is for moderators only (coaches of the team and admins) and is checked in the chat room. It is stored as a mention of person ID 0 and creates one reference per member in D1; children without read permission do not count for themselves, but for their parents. The push goes to the same people as chat pushes, filtered by their setting for mentions, and replaces the bundled chat push.

The message with its mentions lives in the Durable Object, and a reference in D1 (`chat_mentions`) feeds the badge. Deleted messages and cleared chats remove the references.

Mention pushes go out immediately under their own topic, "Mentions in the chat (@name)", so one can switch off normal chat pushes and keep mentions. If a single new message was already announced as a mention, the bundled chat push is skipped.

The number on the app icon counts unread mentions (read means the chat was shown up to that message) and open stand-in requests, for oneself and one's children. Children's mentions count only in teams with parents. Every push carries the current number for the account and the service worker sets it; the app also asks `/api/badge` at start, on return and after reading.

## Profile picture

Pictures are stored in D1 rather than R2. The browser crops them to 256 × 256 pixels, usually 10 to 30 KB (upper limit 150 KB). No further resource is needed, and deleting them at leaving or the season change goes with the other personal data. Each person has one approved and one waiting picture.

The format is WebP where the browser can produce it, otherwise JPEG (Safari does not produce WebP). The server detects the format from the first bytes, not from the declared type, and serves only these two formats with `nosniff`.

Only the birth year is known. Whoever turns 18 this year counts as an adult, and so does a person without a birth year. For minors the birth year must therefore be filled in.

Any linked parent can approve, even if the team runs without parents, because consent is a legal question and not one of team organisation. Admins can only remove pictures, not approve them.

The picture address contains its version, so the picture under it never changes and is cached privately for a year. The app loads the list of all pictures once and shares it between views.

## handball4all

handball4all is an optional module. The schedule is fetched only in the browser of a coach or admin, never by the server, because the interface blocks automated access. It is fetched only by hand (Team → Settings → Game schedule → "Sync now"), never automatically, because the interface is meant for fair use. The server hands out a job for 10 minutes, checks the result, stores it and then locks the team for 10 minutes. If the fetch fails, the browser releases the job at once.

Games are matched by their handball4all game ID. The own team is the name that appears in every game. Future games that are no longer in the schedule are cancelled. Fields that coaches maintain (meeting point, notes) are never overwritten by the import.

Match days are recognised by the placeholder "Spieltag …" as home or guest team, without a separate team type. The link needs the club's team ID in the league as usual, and handball4all then delivers all match days. A match day is a home match day if the host is the own team or it is played in one of the club's halls. Duties apply as for games.

Without the module, games are entered by hand or imported from a table (CSV).

## Push and chat

Web Push is an own implementation of VAPID (RFC 8292) and aes128gcm (RFC 8291) on Web Crypto, checked against the test vector of RFC 8291. Push jobs are created only for accounts with a registered device, and devices that answer 404 or 410 are deleted. The VAPID contact is the app's address, never a personal e-mail. Without `ORIGIN` the app remembers the address under which a device registered for push.

Chat pushes are bundled: after the first message the chat room waits 20 seconds and then notifies everyone who is not connected and has not read yet.

Reactions are 👍 ❤️ 😂 😢 👋, one per person and message (a new one replaces the old one, the same one again takes it back), not on one's own messages. Whoever may write may react. Tapping shows the names; former members by name only for coaches. Reactions send no push and are stored in the chat room like the messages.

Admins send a broadcast to all or selected team chats under Administration → Broadcast. It appears as a highlighted card with the admin's name; people can react to it and coaches can remove it. A switch decides the notification: immediately to everyone like `@alle` (with the badge count), or like a normal chat message (bundled chat push).

Only admins delete a person, never themselves, and confirm by typing the name. This deletes the person with access, memberships, responses, nominations, links and profile picture (ON DELETE CASCADE); parents without another child and without an own role go too. Their chat messages remain as "Deleted person" (also for coaches), their reactions are removed. The normal way out is leaving the club.

By default the chat list of an admin shows only chats in which the admin is a member, coach or parent. All others are under Administration → All chats and do not count for the unread dot. Reading and moderating stay allowed in every chat.

Names in the chat are "Kim M.", with "Coach", "Staff", "Stand-in" or "Parent of …". The gender of a person is not stored. People who left appear as "Former player" to everyone except coaches.

## Season and defaults

Age groups come from the sport profile (`sports/<id>.ts`) with ages relative to the start year of the season. They have no gender; a team has an age group, a gender (female, male, mixed) and a level. The playing time and whether home games need a youth referee are properties of the age group. Admins can change the age groups of a season.

Defaults: decline deadline 6 hours, squad at most 20 (see Automatic squad), muting in the chat until lifted. Everything can be changed per team or in the app.

## Helper plan

The helper plan is an optional module and is switched on per team. The "Helpers" tab lists the teams with a helper plan.

Parents, coaches and admins help; players themselves only in teams without parents. In children's teams the parents help, older youths without parent access sign up themselves. Since duty types exist, this is decided per duty type (see Helper duties).

Admins see all teams with a helper plan in the "Helpers" tab. A switch "Own teams / All teams" first shows only their own (as coach, player or parent); under all teams their own come first. The switch appears only if both exist. As with the chats: everyday work first, the overview on request.

The red marker "Helpers needed" in the event overview follows the same rules as the notification "Helpers wanted" (recipients, allowed duties, "I can do this"), but for all upcoming games in the list, not only three days before. Coaches and admins do not get it, they have the management view and the open slots. If the family already has a duty at the game, there is no red marker, so each game shows at most one hint.

Admins who coach a team or have a child in it get the open slots notification only for those teams, even if none of them uses the helper plan. Only admins without any team get it for all teams with a helper plan.

Simultaneous sign-ups are atomic (`INSERT … SELECT … WHERE count < slots`); the second one gets "Sorry, this place has already been taken." (`slot_taken`).

One Durable Object per team (`DutyHub`) only broadcasts "reload" and stores nothing. As a fallback the page polls every 5 minutes while it is visible.

The calendar is a subscription link (webcal) with a personal key instead of a native calendar integration, which would need Google or Apple accounts; an .ics download exists too. Only the hash of the key is stored. Under Profile → My events one ticks training, games and helper duties. The feed is computed with the account's actor, so visibility and parent rules apply exactly as in the app.

Calendar titles group several children by status ("Kim and Alex nominated", "Kim accepted, Alex declined"), so no title is ambiguous. Special events count under training. The meeting point is a separate calendar entry, so parents see when to meet without losing the start time.

The e-mail address of an access may be used for helper plan mails, but only if the person switches it on per topic in the profile (default off). Mails go out with the display name "<club> helper plan". Many parents do not use push, which is why mail is offered. With the SMS module, reminders can also go by text message.

Parent links connect at most two parents per child, admins can link more. This protects against links that are passed on.

## Helper duties

The data model has duty types (`duty_types`), templates (`duty_templates`, `duty_template_items`) and time blocks per event (`event_duties`). Sign-ups (`duties`) belong to a block. A special duty is a duty type with an `event_id`. The sport profile brings the default duty types.

"Who helps" is set per duty type. "Parents" means the parents, or the players themselves in teams without parents. Coaches and admins may always sign up.

"Needs prior knowledge" is a property of the duty type; the consent is given per access in the profile under "I can do this" (`skill_consents`). It is off by default, so nobody becomes timekeeper without being asked. Timekeeper and scorer are the same qualification: the profile has one switch that sets both consents (recognised by the duty type's `code`); internally they stay two.

Templates exist only for the whole club. Admins maintain them, coaches choose one per team for home and away games (empty means the default). Times are relative to start and end, so the same template fits games of every age group and special events. Changing or switching a template recreates the blocks of upcoming games without sign-ups; games with sign-ups stay as they are, so nobody is silently removed.

Games get their blocks on demand (`ensureEventDuties`) instead of at import, so sync, games entered by hand and template changes take the same path. `events.duties_generated` remembers what was already created (1 = template, 2 = youth referee), so removed blocks do not come back. `events.duties_anchor` keeps the start time at creation: if a game is moved, all blocks move by the same difference.

A task is a block with start equal to end, a moment before or after the event. There are no minutes, only "Before" and "After", because the exact time does not matter. In the calendar a task lasts 15 minutes.

There is no choice between "myself" and "for my child". The person signing up is always the helper, and a child in the team is linked automatically (the first one if there are several). The choice was hard to understand and its only effect was whether the other parent saw the duty. The exception is the youth referee duty ("Who referees?"), where the child referees itself.

Coaches and admins can sign up any active person of the club, regardless of "Who helps" and prior knowledge (for example an A youth player as timekeeper). The search (`?q=`, from 2 characters, at most 20 results) returns only short name and teams, and only to coaches and admins. The youth referee duty stays bound to the role.

Whoever creates a special event (`events.created_by`) always manages its helper duties, also in the view of a team they do not coach. Coaches, admins and the creator add further organisers (`event_organizers`). Organisers manage only the helper duties (blocks, slots, times, signing people up and off), not the event, the participants or decline reasons. They see the event even without a team, then only with the event information, and they get the open slots notification.

"Full club member" is a hidden attribute that only admins see and set (person detail). It is a link in `club_members`, not a field on the person. Everyone who is assigned as player or coach of a team becomes a member automatically; assigning again sets it again after it was switched off, the season change does not. It matters in two places: only a full member with access can become an organiser, and duty types can have "Who helps: members" (full members who belong to the team, including parents).

Coaches may create a duty type for a single special event. It disappears with its last block and does not show in the club-wide list, so the admins' list stays clean.

## Youth referees (KiHaSL/JuHaSL)

Youth referees are an optional module. In the code the duty is called `referee` throughout (tables `referees` and `referee_links`, topic `duty_referee_open`, view `refereeview`). The German UI calls it "KiHaSL/JuHaSL".

Whether home games of an age group need a youth referee is a property of the age group (`age_classes.youth_referee`), set by the sport profile and editable by admins. In handball these are the E, D and C youth.

Every such home game needs a referee, so the referee view shows all of them, even if the team does not use the helper plan.

The referee link can be used many times, is valid for 30 days and can be revoked; only its hash is stored. It creates no person and no access, it only gives people who are already signed in the role for themselves or their own child. The role must not open the app to strangers.

Children often referee without an own access. The sign-up names the child as helper (`person_id`) so it shows in lists; the parents sign it up, get the reminders and can sign it off.

A game with an own referee duty is visible even without a team, but without participant list and without accepting or declining. Open referee slots create no red marker, otherwise it would sit on almost every youth game.

Changes to the referee duty are announced to the team's `DutyHub` and to an extra hub (key 0) for the referee view.

## Players in two teams

When a coach adds a player from another team, the candidates are players of other teams of the same age group (any level) and of the next younger age group with a matching gender, as for stand-ins but without the level restriction. Older players are not offered, so nobody is moved down by mistake. The player's current coaches are informed.

If two games overlap, both squads stay and nothing decides automatically. The nomination shows all overlapping games with team and time. The reminder three days before goes to each person only once per time window (±3 hours).

At the season change the youth teams are formed anew by birth year, with the first team as suggestion; second teams are formed by the admin afterwards. Adult teams stay complete. A person can be assigned to up to three teams.

In the participant list of a joint event, a person is assigned to one team in a fixed order by name (D1 before D2) and labelled with all teams involved.

## Holidays

Holidays are named periods that admins create, change and delete freely, imported ones included. The earlier logic of adding and removing single days was hard to understand.

School holidays and public holidays of the club's country and region (club profile) come from OpenHolidays once per season at the season change, for the whole new season, and replace the list. If the source is not available, the list stays unchanged and can be filled in by hand. There is no regular import, so manual changes are not overwritten. No trainings are generated on public holidays.

Holiday plans are linked to a period (`training_plans.holiday_period_id`) and follow its changes. Own dates in the plan detach it; deleting the period leaves the plan with its dates.

## Admin views

Admins can see the app from another perspective for testing. These views are reached only through the address; the app has no link or hint to them: `?playerview=1` (first own child by first name), `?parentview=1` (oneself without admin and coach rights), `?trainerview=1` (coach of the first own coached team, else of the first child's team; if one coaches it oneself, it is oneself with write access, otherwise the coach with the smallest ID), `?refereeview=1` (oneself without admin and coach rights, with the youth referee role, with write access).

The flag sets the cookie `kabine_view` and disappears from the address. The server reads the cookie only for admins and builds the actor from it; for everyone else it has no effect. A red bar names the view and ends it ("End" deletes the cookie).

Player and coach views load the real person, because event visibility is computed in SQL from real team memberships; a simulated role would see nothing.

Views of another person are read only: unsafe API calls end with `view_read_only`, and in the chat one only reads along. Nothing happens in the name of a child or coach. The parent and referee views are oneself with other rights and may write.

The account stays one's own in every view: chat read markers, push devices and settings of the viewed person stay untouched.

## Protected owner access

If another admin account is taken over, it must not take the access of the person who runs the installation. The owner is the person who set up the installation with the setup link. This is stored in the club profile and only the owner can hand the role to another admin (`PUT /api/admin/club/owner`).

For everyone else these actions on the owner are blocked: removing admin rights or changing the admin address, deleting the person, removing the access, leaving the club, creating a personal link, marking as former at the season change. The answer is 403 `owner_protected`. A personal link for the owner can only be redeemed if the owner created it.

What the owner does to themselves stays allowed. Other admins can still change name, teams and similar details, which do not touch the access.

## Attendance after an event

After the start coaches record per participant *present*, *excused* or *unexcused* (`PUT /events/:id/attendance/:personId`). The entries live in their own table `attendance_marks` (event, person, status, who, when) instead of a new status in `responses`: the player's yes/no stays as it was, the coach's entry wins. There is no reason and no free text.

Without an entry the response counts (`defaultMark` in `shared/attendance.ts`): accepted is present; declined, away long-term and inactive are excused; who did not respond stays open and is listed first as "Still to record". An entry equal to that default is not stored, so the table holds only the differences, for example "declined but came anyway". *Unexcused* is possible only for someone who did not decline; optional participants are only *present* or *not there*.

Coaches record until the end of the day after the event (local time), admins (not in coach mode) the whole season. The attendance record (`attendance`) follows a later entry: present stays present, excused becomes declined, unexcused stays unexcused; an optional participant gets a row only if present, and a short-notice decline is not late if the person came.

Coaches and admins see all entries; the person and their parents see their own entry at their response where it differs from it ("Was there", "Excused", "Missed without excuse"). Other players do not get the participant list anyway. There is no push.

Entries belong to the events and are deleted with them at the season change. The admin export contains the table. The former table `unexcused_absences` was copied into it and is dropped in a later release (`migrations/README.md`); the old route `PUT /events/:id/unexcused/:personId` stays for app versions still cached on devices.

The event overview has a switch "Upcoming / Past" for everyone. Past events are those visible up to now, newest first; events older than the current season are gone after the season change. Only coaches and admins get the number of marks.

The team labels at the top of the event overview are filters (one team; tapping again lifts it), remembered for the browser session. They appear from two teams on.

## Backup

Restoring uses D1 Time Travel instead of own weekly backups.

The admin export is the backup to keep independently of Cloudflare, once per season. It contains all tables with club data, the chats, the e-mail addresses of the accesses and the profile pictures; credentials stay out. A test makes sure every table is exported or deliberately excluded. Before each download the admin confirms a notice: for backup only, not to be passed on, the copy on one's own computer to be deleted after 30 days at the latest, and the club's managers to be told at once about unauthorised access. Every export is logged as `admin_export` with person and account ID and time in the Worker logs (not visible in the app).

## Attendance and statistics

Who was expected is computed from the current state. For statistics every event is therefore recorded once after its start (`attendance`, marker `events.attendance_recorded_at`), hourly in the cron, at most 150 events per run. Cancelled events are not recorded.

"Absent without excuse" also changes the recorded entry. Other changes after the start, such as responses, do not exist.

At the season change all open events are recorded first and then condensed per person and team name into `season_stats` (training and game totals, present, absent without excuse, late declines, duties, youth referee duties). Late counts declines after the deadline. Totals count only events at which the person was expected (not inactive, not away long-term). Only these figures stay over the years; they are deleted with the person.

There is no screen for this yet. A later statistics view will show names only to coaches and admins. Record and figures are part of the admin export.

## Live ticker

The app fetches no scores from handball4all and polls nothing. Only when someone taps "Live ticker on handball4all" does a new window open at once; the device fetches the team's schedule once (without cookies, without referrer), reads the game's ticker key from it and sends the window to the handball4all ticker page. Nothing is stored, neither in D1 nor in a Durable Object. The redirect starts in the new window itself (link with `rel=noreferrer`, page with referrer policy `no-referrer`), so handball4all sees no referrer of the app. Without a key, the team's page opens. One fetch per tap puts no more load on handball4all than a visit to their site and does not endanger the schedule sync.

From the start of the game the event overview shows a "Game in progress" card at the top, and the game shows the "Live ticker on handball4all" button for the playing time of the age group (`game_minutes`). If several teams play, the longest time applies. Without polling the app does not know the real end of the game, so it uses this fixed time. This applies only to teams with a handball4all link.

Afterwards, up to 7 days after the start, the game shows "Game report on handball4all". It works like the ticker: one fetch of the schedule on tap, the report number taken from it, opened in a new window without referrer. handball4all publishes the report about 20 to 30 minutes after the end; until then the window shows a note. Nothing is stored.

## Meeting point before the game

Each game has "Meeting point & info": the meeting point as text with quick choices (the club's halls and the venue of the game), the time always entered individually.

The large cards in the event overview show "Meet at 08:45 · Main hall". Coaches see a hint there as long as both are missing.

For games in the next three days without a meeting time, the team's coaches get a push from 8 am, once per game and team (idempotent through `duty_notifications`, kind `meeting`). The time is what matters, because the place is usually the same.

## Special events and own games

There are two kinds. Games without handball4all (friendlies, tournaments) stay games with squad, meeting point, helper duties and game statistics. Special events (photo shoot, party) invite everyone in the team, like a training.

Team → Create event first asks "Game" or "Special event". A new game ends after the playing time of the age group and notifies the players of the team (parents by the usual rules). Administration has only special events, because they can apply to several teams or the whole club.

A special event has an edit sheet with title, date, time, place and info (instead of "Move"). If date, time or place change, everyone is notified; title and info alone are saved silently. Trainings keep "Move".

Administration → Special events and games lists upcoming events created by hand for all teams, except those the admin sees under events anyway. Past ones are not listed.

In the team, under "Create event", a collapsible section "Special events and own games" lists the upcoming events of this team. There is no fourth tab, because the tabs would no longer fit on a phone.

## Parents set up the child's access

Linked parents create a personal one-time link (7 days) under Profile → Child, for the first access or a new passkey, only in teams with parents. Not for children who are coaches or admins themselves.

A link from the parents does not block existing passkeys; the old one keeps working until the child sets up the new one. Blocking stays with coaches and admins.

## Admin/coach switch

Admins who also coach mostly work as coaches. In the profile they switch "Work as admin" off and see the app like a coach.

The choice is stored on the account (`accounts.coach_mode`) and applies on all devices. In coach mode the server builds the actor without admin rights, and the admin views are off too. The way back is only the switch, which checks the person in the database, not the actor. The owner protection is not affected.

## Responses visible to the team

Each team has the switch "Responses visible to everyone" (Team → Settings, coaches and admins), off by default. Youth teams usually keep it off, so that declines by others do not cause a domino effect; adult teams often want to see who is coming.

When it is on, players and involved parents who take part in the event themselves or through their child see "Kim M." and the status (accepted, declined, open, absent) for trainings and special events. Decline reasons never. For joint events only if all teams involved have the switch on. Games and club-wide events are excluded; a second switch for games is planned. Team staff always see names and status, never reasons (see `docs/dev/decisions.md`).

## Sharing invitation links

"Share with text" and "Copy text" send a ready text with the player or parent link: what the app is, that the link is meant once per person and only for oneself, a hint for those who already have an access (parents open the link on the device with the app and sign in first), how to install the app, and the expiry date. This prevents duplicate accesses and wrong choices.

## Groups

For circles without training and games (coaching team, youth referees) there are groups: only chat and special events with responses, reminders, push and calendar. No training, no games, no squad, no helper plan, no parents, no age group. In the UI the members are "Members" and "Leads" (internally `player` and `coach`).

A group is a row in `teams` with `kind = 'group'`. Chat, push, unread counters, `@alle` and special events work unchanged. Team features reject groups with `group_not_supported` (`requireTeam`).

The youth referee group has `auto_members = 'referees'`: the members are all people with the role, the leads all admins, without parents. It is synced on every role or admin change and nightly in the cron. Nothing can be assigned there by hand.

At the season change groups do not appear in the assignment; their members and leads stay. The chat is cleared as for teams.

In groups, @ suggests all members and leads, also those who never wrote. In teams it stays with coaches and people who have written (protection of the children).

Admins create groups under Administration → Groups; there and on every group page the difference to a team is explained. Admins assign the members; leads create special events and moderate the chat.

## Last activity

Admins find orphaned accesses under Administration → People: "active today", "active 12 days ago", "Access never used", "no access", the filter "Not active for over 60 days" and the sort order "Last active".

This is not a personal field but a technical date on the access (`accounts.last_seen_on`), to the day only (local date), visible only to admins. It is set at sign-in and at the at most daily extension of the session, so it costs no extra writes per page view.

## Maintenance mode

During larger actions (migrations, data changes) only admins get into the app, so nobody writes into a half-converted state. Admins see a red banner.

The switch is a command (`npm run maintenance:on` / `maintenance:off`), not part of the app, because it belongs to deployments. The value lives in KV instead of D1 so it applies regardless of the database schema; KV caches it for 30 seconds per location, so it takes effect after about a minute at most.

Cron runs pause, so no reminders go out from a half-finished state; the next run catches up. The push queue keeps running for the admins' actions.

Everyone else sees a fixed notice. The page checks every 20 seconds and returns by itself. The notice page has no sign-in button; admins sign in beforehand.

## Carpools

Carpools are an optional module for away games (`kind = 'game'`, `is_home = 0`), without fixed assignment: drivers offer free seats, passengers book themselves or wait.

As an exception to the name rule, nominated players, their responsible parents, coaches and admins see drivers and people looking for a lift as "Kim M." with the number of seats, also in the chat note the day before. Without names nobody can arrange pick-up and meeting place. Team members who are not nominated see nothing. Players and parents see carpools only after the squad is published.

Nominated players (stand-ins too) who have not declined and are active can look for a lift, and so can the coaches of the teams involved. Coaches can also drive. There is one request per person and game with 0 to 2 companions (for players, their parents), so 1 to 3 seats. Only the number is stored, not the names of companions.

There is one offer per person and game, with 1 to 8 free seats besides the driver's own passengers. The offer belongs to the person, not to the access, so coaches can enter parents without the app. Whoever drives does not look for a lift for themselves or their child, and the other way round (`409 carpool_family`).

Booking is atomic through a conditional `UPDATE`: whoever books first gets the seat, otherwise `409 carpool_full`. The driver gets a push "Kim M. + 1 is riding with you". A new request while seats are free sends no push, because the free seats are offered right away.

Drivers can reduce seats, take passengers out or withdraw the offer. Going below the bookings requires choosing whom they no longer take (`409 carpool_overbooked`). Those taken out are looking again and get a push; the same offer is not announced to them as free again.

When an offer is new, gets more seats or seats become free, everyone waiting whose need fits gets a push, at most once per pair of offer and request (`duty_notifications`, kind `carpool-match`). IDs use `AUTOINCREMENT`, so a new offer never inherits the mark of a deleted one.

Coaches of the teams involved and admins can do everything for others: drivers (nominated players, their responsible parents, coaches), requests, bookings, taking people out. Many teams still arrange lifts in a messenger group while parents are being set up. Pushes go to the people concerned with "(entered by Alex)", not to the coach.

Whoever declines or is taken out of the squad by the coach loses the request; a booked driver gets a push and free seats go to those waiting. The automatic squad, a withdrawn stand-in and leaving the club delete silently.

On the calendar day before the game, from 10 am and from 6 pm, each team gets one system message in the chat with the names of those still looking, only if someone is looking, at most 300 characters. System messages do not trigger chat pushes.

Carpools have their own topic under Profile → Notifications.

The large game card in the event overview (not the small rows) shows "Carpools (taken/offered)" as soon as the game has an entry, plus "· n are still looking" for those without a seat. It is shown only to those involved, as in the detail view.

If a family member drives (parents, children, siblings), the whole family counts as covered: nobody in the family is offered a request, and the server rejects one (`carpool_family`). This also holds when a minor player offers the seats. There is at most one request per family; other family members ride along as companions. Companions are offered with the parents' names ("Kim M.", only for the own family and for coaches), but still only the number is stored.

## Database read load

D1 bills every row a query touches, not only those returned, and the free plan has a daily limit per account. A few queries caused most of the reads, so they were rebuilt.

The event list first collects the events that could be visible at all: teams of the person and their children (any role), nominations, stand-in requests, duties, organised, self-created and club-wide events. Only then does it apply the unchanged visibility check. The preselection is a superset, so the result stays the same; it uses the same people as the check and not the roles on the actor, because the admin views remove coach roles there. `MATERIALIZED` and `CROSS JOIN` are needed, otherwise SQLite walks all events in the range again. There are two groups because D1 allows at most five parts per `UNION` (`CANDIDATES_CTE` in `worker/domain/events.ts`).

Indexes cover event kind with start (special events in the helper plan), creator, club-wide events, duties by person and event and by child, and the events of a team. There is no `ANALYZE`, so the query plans are the same locally and in production.

A comparison test (`test/visibility.test.ts`) checks for many roles, ranges and filters that the fast query returns exactly the same events as checking every event. A second test (`test/query-plans.test.ts`) records the statements actually run by the event list, the helper plan and one's own duties, and checks their query plans: no scan of all events (`SCAN events`) and no range over `events_starts`. Rows read cannot be measured locally, Miniflare always reports 0.

The "Helpers" tab polls only every 5 minutes; changes arrive at once over the live connection anyway.

The event overview loads 20 events per section, and "More events" loads 20 more each time. Upcoming has no date limit (the season change deletes old events), past is newest first. The server filters relevance and team, so 20 are always 20 matching ones. The team filter applies after visibility, not through `teamId`, otherwise admins would see all events of the team. The preselection is sorted by date and limited before the check, so the visibility check runs only for the next events. A page never ends in the middle of a day. The next own event for the large card (at most 70 days ahead) and open stand-in requests come separately, so the page for coaches without own events does not grow to 70 days again. The loaded list is kept when opening an event and coming back, and stays in place while loading more. Offline the app filters the last loaded list itself. Without `limit`, `/events` answers as before (range, older app versions). See `worker/domain/event-page.ts`.

# SMS

Sign-in codes and helper plan reminders by text message, for people who enter a mobile number. Off by default; it needs an account at an SMS provider (costs per message). First provider: [seven.io](https://www.seven.io) (German company, servers in the EU).

- **Stores:** the mobile number of people who enter one themselves, and whether it is confirmed (`accounts.phone`, `accounts.phone_verified_at`). The provider key is stored encrypted with a key derived from `APP_SECRET`.
- **Who sees it:** nobody but the person, not even admins.
- **Deleted:** when removed in the profile, when the person leaves the club.

The core sends text messages through the hook `texts` of this module (`worker/domain/texts.ts`): sign-in codes (`worker/domain/email-login.ts`) and helper plan reminders. The phone number in the profile and the "code by SMS" sign-in are core screens (`src/pages/profile.tsx`, `src/pages/login.tsx`) that show while the module is on.

## Another provider

Add it in `worker/provider.ts` (`SmsConfig.provider`, `sendSms`) and offer it in `app/settings.tsx`. Test it with a recorded response in `test/provider.test.ts`; never call the provider from tests.

## Code

| File | What |
| --- | --- |
| `module.ts` | manifest |
| `worker/index.ts` | routes and the `texts` hook |
| `worker/routes.ts` | `/api/admin/sms`, `/api/auth/sms/start`, `/api/me/phone` |
| `worker/settings.ts` | provider settings, sending |
| `worker/provider.ts` | provider adapter (seven.io), phone number format |
| `app/index.tsx`, `app/settings.tsx` | settings page under Administration |

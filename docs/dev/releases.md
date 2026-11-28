# Releases

How a Kabine release is made and how it reaches the clubs. Clubs see the result in `docs/operation.md` ("Updates", "Installing an update", "Update notices").

## How a release reaches a club

1. The release is a tag `vX.Y.Z` on GitHub. Release candidates get no public tag (`docs/dev/decisions.md`, "Release candidates").
2. kabine.dev publishes `https://kabine.dev/releases.json` (built by `npm run site:build` from `CHANGELOG.md` and `shared/changelog.ts`, `site/src/releases.mjs`). Every installation fetches it once a day from 10 o'clock club time on the server (`worker/domain/releases.ts`, unless an admin switched it off) and tells its admins: a hint in *Administration*, the section *New versions* under *Updates and maintenance*, one push per new version (topic `updates`).
3. Once a week, or when run by hand, the workflow `.github/workflows/update.yml` in the club's copy opens the pull request "Update Kabine to vX.Y.Z". Merging it deploys the release (`scripts/deploy.mjs`).

So the site must be deployed with every release, after the tag: until then installations do not know the new version. The file is cached for an hour.

## Steps

1. In `CHANGELOG.md`, *Unreleased* becomes `## vX.Y.Z`; add the entry to `shared/changelog.ts` (version, release day, items for the app) and set `version` in `package.json` (`test/changelog.test.ts` checks that they match).
2. A security release gets the marker line (below).
3. Commit, tag `vX.Y.Z`, push the tag.
4. Deploy the demo from the tagged commit and reset it (`CLAUDE.md`, Releases).
5. Deploy the site (`npm run site:deploy`), so `releases.json` names the new version, and check `https://kabine.dev/releases.json`.

## Security releases

A release that fixes a security problem gets this line as the first line of its section in `CHANGELOG.md`, directly under the heading:

```md
## v1.0.1

**Security release:** fixes a problem with invitation links. Install it soon.

- …
```

The line must start with `**Security release:**` (or `**Security release.**`); `site/src/releases.mjs` looks for it at the start of a line and sets `"security": true` for the version. The app then shows "Security update" in red, its hint in *Administration* cannot be closed, and the push says so. An installation that skipped versions sees the update as a security update as long as any version since its own is one. The update pull request shows the line too (it carries the release notes). Name what is affected, not how to exploit it, until clubs had time to update (`SECURITY.md`).

## releases.json

```json
{
  "latest": { "version": "1.0.1", "date": "2026-12-10", "notes": "https://kabine.dev/en/news/#v1-0-1", "security": true },
  "versions": [ /* the last 10 releases, newest first, same fields */ ]
}
```

`notes` is the version's heading on the release notes page. Installations accept only links to kabine.dev and versions of the form `X.Y.Z`; anything else in the file is ignored (`shared/releases.ts`, `parseReleaseFeed`). Keep the fields: older installations read them. New fields can be added.

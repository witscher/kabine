// Release notes for the update pull request of a club's copy (.github/workflows/update.yml): every version
// section of CHANGELOG.md newer than the installed version, newest first, so a copy that skipped releases sees
// what all of them change. Kept apart from the command line so test/update-notes.test.ts can run it.

const norm = (v) => String(v ?? "").trim().replace(/^v/, "");

/** The sections "## vX.Y.Z" above the installed version; all of them if it is not found (older copies). */
export function notesSince(changelog, installed, maxLines = 300) {
  const stop = norm(installed);
  const out = [];
  let inVersion = false;
  for (const line of changelog.split("\n")) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      const v = /^v(\d+\.\d+\.\d+)\s*$/.exec(heading[1]);
      if (v && v[1] === stop) break;
      inVersion = !!v; // "Unreleased" and other headings are left out
    }
    if (inVersion) out.push(line);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  if (out.length > maxLines) return [...out.slice(0, maxLines), "", "… (more in CHANGELOG.md)"].join("\n");
  return out.join("\n");
}

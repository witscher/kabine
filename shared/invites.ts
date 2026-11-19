/**
 * A team counts as set up once more than this many people of a link's kind have an access (players for the player
 * link, parents of the team's players for the parent link). Creating a team link then shows a hint to use personal
 * links instead; it stays allowed (docs/dev/security.md, trust model).
 */
export const TEAM_SET_UP_AFTER = 5;

export function teamSetUp(withAccess: number): boolean {
  return withAccess > TEAM_SET_UP_AFTER;
}

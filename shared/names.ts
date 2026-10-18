// Short names ("Lina B.") for places where people see others outside their role, e.g. invitation links.

export function shortName(firstName: string, lastName: string | null): string {
  return lastName ? `${firstName} ${lastName.charAt(0)}.` : firstName;
}

/** Short names; where two are equal, the birth year tells them apart ("Lina B. (2014)"). */
export function distinctShortNames<T extends { first_name: string; last_name: string | null; birth_year: number | null }>(people: T[]): string[] {
  const names = people.map((p) => shortName(p.first_name, p.last_name));
  const count = new Map<string, number>();
  for (const n of names) count.set(n, (count.get(n) ?? 0) + 1);
  return names.map((n, i) => (count.get(n)! > 1 && people[i]!.birth_year ? `${n} (${people[i]!.birth_year})` : n));
}

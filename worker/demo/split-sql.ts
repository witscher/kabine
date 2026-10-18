// Splits an SQL file into single statements. D1's exec() treats every line as a statement, so the
// multi-line statements of seed/demo.sql are run one by one with prepare(). Understands -- comments
// and 'quoted ''strings''', which is all the seed uses.

export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (quoted) {
      cur += ch;
      if (ch === "'") quoted = false;
      continue;
    }
    if (ch === "'") {
      quoted = true;
      cur += ch;
    } else if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      cur += "\n";
    } else if (ch === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

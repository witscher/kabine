// Dünne Hilfen um D1. Listen werden als JSON übergeben und mit json_each()
// aufgelöst, damit es keine Grenze bei der Anzahl gebundener Parameter gibt.

export type Param = string | number | null | boolean | ArrayBuffer | Uint8Array | undefined;

function bindable(params: Param[]): (string | number | null | ArrayBuffer)[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    if (p instanceof Uint8Array) return p.slice().buffer as ArrayBuffer;
    return p;
  });
}

export function stmt(db: D1Database, sql: string, ...params: Param[]): D1PreparedStatement {
  const s = db.prepare(sql);
  return params.length ? s.bind(...bindable(params)) : s;
}

export async function all<T>(db: D1Database, sql: string, ...params: Param[]): Promise<T[]> {
  const res = await stmt(db, sql, ...params).all<T>();
  return res.results;
}

export async function first<T>(db: D1Database, sql: string, ...params: Param[]): Promise<T | null> {
  return (await stmt(db, sql, ...params).first<T>()) ?? null;
}

export async function run(db: D1Database, sql: string, ...params: Param[]): Promise<D1Result> {
  return stmt(db, sql, ...params).run();
}

/** Führt Statements in Blöcken als Batch aus (jeder Block ist eine Transaktion). */
export async function batch(db: D1Database, statements: D1PreparedStatement[], chunk = 80): Promise<D1Result[]> {
  const results: D1Result[] = [];
  for (let i = 0; i < statements.length; i += chunk) {
    results.push(...(await db.batch(statements.slice(i, i + chunk))));
  }
  return results;
}

/** JSON-Liste für `IN (SELECT value FROM json_each(?))`. */
export function list(values: readonly (number | string)[]): string {
  return JSON.stringify(values);
}

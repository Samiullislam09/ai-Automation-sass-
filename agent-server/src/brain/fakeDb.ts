/** A Supabase stand-in for tests: enough of the query builder to run the orchestrator, and
 *  nothing more.
 *
 *  WHY NOT A REAL DATABASE. The orchestrator's interesting behaviour — a parallel join, a
 *  retry with backoff, a resume after a crash, two clicks becoming one task — is all about
 *  ordering, and ordering is exactly what a shared test database makes flaky. This fake runs
 *  in memory, in microseconds, and can be asked "what did you actually write?".
 *
 *  It supports only the shapes the brain uses: `.from(t).select(...).eq(...).order(...)`,
 *  `.insert(rows).select(...).single()/maybeSingle()`, `.update(patch).eq(...).in(...)
 *  .select(...).maybeSingle()`, plus `.lte()` and `.limit()`. Anything else throws loudly
 *  rather than silently returning nothing — a fake that quietly answers "no rows" is how a
 *  green test hides a broken query.
 */

type Row = Record<string, any>;

export type Unique = { table: string; columns: string[] };

export class FakeDb {
  tables = new Map<string, Row[]>();
  private uniques: Unique[];
  private seq = 0;

  constructor(opts: { uniques?: Unique[] } = {}) {
    this.uniques = opts.uniques ?? [];
  }

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  private nextId() {
    this.seq += 1;
    return `id_${String(this.seq).padStart(4, "0")}`;
  }

  from(table: string) {
    return new Query(this, table, this.rows(table), this.uniques, () => this.nextId());
  }

  /** The Realtime side is not exercised here; events.ts is tested with its own fake. */
  channel(): any {
    throw new Error("FakeDb.channel() called — inject a broadcast hook in the test instead");
  }
}

type Filter = (r: Row) => boolean;

class Query {
  private filters: Filter[] = [];
  private orderBy: { column: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private mode: "select" | "insert" | "update" = "select";
  private payload: Row[] = [];
  private patch: Row = {};

  constructor(
    private db: FakeDb,
    private table: string,
    private store: Row[],
    private uniques: Unique[],
    private nextId: () => string,
  ) {}

  select(_cols?: string) {
    if (this.mode === "select") this.mode = "select";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  lte(column: string, value: string) {
    this.filters.push((r) => r[column] != null && String(r[column]) <= String(value));
    return this;
  }
  order(column: string, opts: { ascending?: boolean } = {}) {
    this.orderBy = { column, asc: opts.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.mode = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row) {
    this.mode = "update";
    this.patch = patch;
    return this;
  }

  private matching(): Row[] {
    let out = this.store.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderBy) {
      const { column, asc } = this.orderBy;
      out = [...out].sort((a, b) => {
        const x = a[column], y = b[column];
        if (x === y) return 0;
        return (x > y ? 1 : -1) * (asc ? 1 : -1);
      });
    }
    if (this.limitN != null) out = out.slice(0, this.limitN);
    return out;
  }

  private run(): { data: any; error: any } {
    if (this.mode === "insert") {
      const created: Row[] = [];
      for (const row of this.payload) {
        for (const u of this.uniques) {
          if (u.table !== this.table) continue;
          if (u.columns.some((c) => row[c] == null)) continue; // partial index semantics
          const clash = this.store.find((r) => u.columns.every((c) => r[c] === row[c]));
          if (clash) return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${u.columns.join(",")}` } };
        }
        const full = { id: row.id ?? this.nextId(), created_at: row.created_at ?? new Date().toISOString(), ...row };
        this.store.push(full);
        created.push(full);
      }
      return { data: created, error: null };
    }

    if (this.mode === "update") {
      const hits = this.matching();
      for (const r of hits) Object.assign(r, this.patch);
      return { data: hits, error: null };
    }

    return { data: this.matching(), error: null };
  }

  single() {
    const { data, error } = this.run();
    if (error) return Promise.resolve({ data: null, error });
    const list = data as Row[];
    if (list.length !== 1) return Promise.resolve({ data: null, error: { message: `expected 1 row, got ${list.length}` } });
    return Promise.resolve({ data: list[0], error: null });
  }

  maybeSingle() {
    const { data, error } = this.run();
    if (error) return Promise.resolve({ data: null, error });
    const list = data as Row[];
    return Promise.resolve({ data: list[0] ?? null, error: null });
  }

  /** `await query` with no terminal call — the list form. */
  then(resolve: (v: { data: any; error: any }) => unknown, reject?: (e: unknown) => unknown) {
    try {
      return Promise.resolve(this.run()).then(resolve, reject);
    } catch (e) {
      return Promise.reject(e);
    }
  }
}

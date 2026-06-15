// ============================================================
// In-memory mock of the slice of SupabaseClient our helpers use.
// ------------------------------------------------------------
// Supports the query-builder chains in lib/supabase.ts:
//   from(t).select().eq().eq().maybeSingle()
//   from(t).select().eq().order()
//   from(t).insert().select().single()
//   from(t).update().eq().eq()
//   from(t).upsert(..., { onConflict })
// plus channel(name).send() / removeChannel() for Realtime.
//
// Test-only. Not shipped. No game logic.
// ============================================================

type Row = Record<string, unknown>;

export interface BroadcastCapture {
  channelName: string;
  event: string;
  payload: unknown;
}

export class MockSupabase {
  tables: Record<string, Row[]>;
  broadcasts: BroadcastCapture[] = [];
  removedChannels: string[] = [];

  constructor(seed: Record<string, Row[]> = {}) {
    this.tables = {
      matches: [],
      seats: [],
      moves: [],
      players: [],
      ...seed,
    };
  }

  from(table: string) {
    const store = this.tables[table] ?? (this.tables[table] = []);
    return new QueryBuilder(store, table);
  }

  channel(name: string) {
    const self = this;
    return {
      name,
      async send({ event, payload }: { type: string; event: string; payload: unknown }) {
        self.broadcasts.push({ channelName: name, event, payload });
        return 'ok';
      },
    };
  }

  async removeChannel(ch: { name: string }) {
    this.removedChannels.push(ch.name);
    return 'ok';
  }
}

type Filter = { col: string; val: unknown };

class QueryBuilder {
  private store: Row[];
  private table: string;
  private filters: Filter[] = [];
  private op: 'select' | 'insert' | 'update' | 'upsert' | null = null;
  private payload: Row | Row[] | null = null;
  private conflictCols: string[] = [];
  private wantSelectBack = false;

  constructor(store: Row[], table: string) {
    this.store = store;
    this.table = table;
  }

  select(_cols?: string) {
    if (this.op === null) this.op = 'select';
    this.wantSelectBack = true;
    return this;
  }

  insert(payload: Row) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.op = 'update';
    this.payload = payload;
    return this;
  }

  upsert(payload: Row, opts?: { onConflict?: string }) {
    this.op = 'upsert';
    this.payload = payload;
    this.conflictCols = opts?.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : [];
    // upsert without a later .select() resolves on its own; expose a thenable.
    return this.runUpsertThenable();
  }

  eq(col: string, val: unknown) {
    this.filters.push({ col, val });
    return this;
  }

  order(_col: string, _opts?: unknown) {
    // Resolve a select list. Sort by the requested column ascending.
    const rows = this.applyFilters();
    rows.sort((a, b) => Number(a[_col]) - Number(b[_col]));
    return Promise.resolve({ data: rows, error: null });
  }

  private applyFilters(): Row[] {
    return this.store.filter((r) => this.filters.every((f) => r[f.col] === f.val));
  }

  async maybeSingle() {
    const rows = this.applyFilters();
    if (rows.length === 0) return { data: null, error: null };
    return { data: rows[0], error: null };
  }

  async single() {
    if (this.op === 'insert') {
      const row = this.payload as Row;
      // Enforce unique constraints the real DB would.
      if (this.table === 'seats') {
        const dupIndex = this.store.find(
          (r) => r.channel_id === row.channel_id && r.seat_index === row.seat_index,
        );
        const dupUser = this.store.find(
          (r) => r.channel_id === row.channel_id && r.opaque_user_id === row.opaque_user_id,
        );
        if (dupIndex || dupUser) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
        }
      }
      const stored: Row = {
        hp: 0,
        max_hp: 0,
        alive: true,
        joined_at: new Date().toISOString(),
        ...row,
      };
      this.store.push(stored);
      return { data: stored, error: null };
    }
    const rows = this.applyFilters();
    if (rows.length === 0) return { data: null, error: { message: 'no rows' } };
    return { data: rows[0], error: null };
  }

  private runUpsertThenable() {
    const exec = async () => {
      const row = this.payload as Row;
      const matchExisting = this.store.find((r) =>
        this.conflictCols.every((c) => r[c] === row[c]),
      );
      if (matchExisting) {
        Object.assign(matchExisting, row);
      } else {
        this.store.push({ created_at: new Date().toISOString(), ...row });
      }
      return { data: null, error: null };
    };
    return {
      then: (resolve: (v: { data: null; error: null }) => unknown) => exec().then(resolve),
    };
  }

  // update().eq().eq() and a bare insert(...) (no .select()) resolve when awaited.
  then(resolve: (v: { data: null; error: { message: string } | null }) => unknown) {
    const exec = async (): Promise<{ data: null; error: { message: string } | null }> => {
      if (this.op === 'update') {
        const rows = this.applyFilters();
        for (const r of rows) Object.assign(r, this.payload as Row);
      } else if (this.op === 'insert') {
        const row = this.payload as Row;
        if (this.table === 'matches') {
          const dup = this.store.find((r) => r.channel_id === row.channel_id);
          if (dup) {
            return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
          }
        }
        this.store.push({
          status: 'active',
          current_round: 0,
          phase: 'lobby',
          boss_hp: 0,
          boss_max_hp: 0,
          boss_alive: true,
          ends_at_epoch_ms: null,
          snapshot: null,
          updated_at: new Date().toISOString(),
          ...row,
        });
      }
      return { data: null, error: null };
    };
    return exec().then(resolve);
  }
}

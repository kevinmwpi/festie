import {
  CACHE_TABLES,
  CATALOG_TABLES,
  LOCAL_SCHEMA_VERSION,
  PERSISTENT_TABLES,
  SCHEMA_VERSION_META_KEY,
  createTableSql,
  getPrimaryKey,
  getTableColumns,
  type TableDefinition,
} from './schema';

export interface LocalDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowId?: number }>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
  /**
   * Runs `callback` inside BEGIN…COMMIT (ROLLBACK when it throws). Inside the callback use only the
   * handle it receives: top-level calls on the database wait until the transaction has finished.
   */
  transaction<T>(callback: (db: LocalDatabase) => Promise<T>): Promise<T>;
}

/** Raw statements of one SQLite connection, without any queuing. Params are already SQL values. */
export interface SqliteConnection {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: unknown[]): Promise<{ changes: number; lastInsertRowId?: number }>;
  getAllAsync<T>(sql: string, params: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: unknown[]): Promise<T | null>;
}

export type DatabaseFactory = () => Promise<LocalDatabase>;

let databasePromise: Promise<LocalDatabase> | null = null;
let defaultDatabaseFactory: DatabaseFactory | null = null;
let databaseFactoryOverride: DatabaseFactory | null = null;

/** Called once by the platform entry (`db.ts` / `db.native.ts`). */
export function setDefaultDatabaseFactory(factory: DatabaseFactory): void {
  defaultDatabaseFactory = factory;
}

/**
 * Wraps a single SQLite connection so every statement and every transaction runs strictly one after
 * another. A connection has one transaction state, so without this a statement issued by an unrelated
 * caller while another caller's BEGIN…COMMIT is open would run inside that transaction (and be undone
 * by its ROLLBACK), and reads could observe half-applied writes.
 *
 * The handle passed to a transaction callback bypasses the queue while the transaction is open (its
 * own `transaction()` joins the running transaction, so helpers can accept either a db or a tx). Once
 * the transaction has finished, a leaked handle falls back to the queued top-level methods.
 */
export function createSerialisedDatabase(connection: SqliteConnection): LocalDatabase {
  let chain: Promise<unknown> = Promise.resolve();

  function schedule<T>(task: () => Promise<T>): Promise<T> {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  }

  const direct = {
    execAsync: (sql: string) => connection.execAsync(sql),
    runAsync: (sql: string, params: unknown[] = []) => connection.runAsync(sql, normaliseParams(params)),
    getAllAsync: <T>(sql: string, params: unknown[] = []) => connection.getAllAsync<T>(sql, normaliseParams(params)),
    getFirstAsync: <T>(sql: string, params: unknown[] = []) => connection.getFirstAsync<T>(sql, normaliseParams(params)),
  };

  const database: LocalDatabase = {
    execAsync: (sql) => schedule(() => direct.execAsync(sql)),
    runAsync: (sql, params) => schedule(() => direct.runAsync(sql, params)),
    getAllAsync: <T>(sql: string, params?: unknown[]) => schedule(() => direct.getAllAsync<T>(sql, params)),
    getFirstAsync: <T>(sql: string, params?: unknown[]) => schedule(() => direct.getFirstAsync<T>(sql, params)),
    transaction<T>(callback: (db: LocalDatabase) => Promise<T>): Promise<T> {
      return schedule(async () => {
        let open = true;
        const handle: LocalDatabase = {
          execAsync: (sql) => (open ? direct.execAsync(sql) : database.execAsync(sql)),
          runAsync: (sql, params) => (open ? direct.runAsync(sql, params) : database.runAsync(sql, params)),
          getAllAsync: <R>(sql: string, params?: unknown[]) =>
            open ? direct.getAllAsync<R>(sql, params) : database.getAllAsync<R>(sql, params),
          getFirstAsync: <R>(sql: string, params?: unknown[]) =>
            open ? direct.getFirstAsync<R>(sql, params) : database.getFirstAsync<R>(sql, params),
          transaction: <R>(nested: (db: LocalDatabase) => Promise<R>) => (open ? nested(handle) : database.transaction(nested)),
        };

        await connection.execAsync('BEGIN TRANSACTION;');
        try {
          const result = await callback(handle);
          await connection.execAsync('COMMIT;');
          return result;
        } catch (error) {
          await connection.execAsync('ROLLBACK;').catch(() => undefined);
          throw error;
        } finally {
          open = false;
        }
      });
    },
  };

  return database;
}

/** Wraps an expo-sqlite database (`execAsync/runAsync/getAllAsync/getFirstAsync`); see `createSerialisedDatabase`. */
export function createExpoAdapter(database: {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown): Promise<{ changes: number; lastInsertRowId?: number }>;
  getAllAsync<T>(sql: string, params?: unknown): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown): Promise<T | null>;
}): LocalDatabase {
  return createSerialisedDatabase({
    execAsync: (sql) => database.execAsync(sql),
    runAsync: (sql, params) => database.runAsync(sql, params),
    getAllAsync: (sql, params) => database.getAllAsync(sql, params),
    getFirstAsync: (sql, params) => database.getFirstAsync(sql, params),
  });
}

/** SQLite cannot bind booleans/objects/undefined portably. */
export function toSqlValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return value;
}

function normaliseParams(params: unknown[]): unknown[] {
  return params.map(toSqlValue);
}

async function getColumnNames(database: LocalDatabase, table: string): Promise<Set<string>> {
  const rows = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${quoteIdentifier(table)});`);
  return new Set(rows.map((row) => row.name));
}

async function createTable(database: LocalDatabase, name: string, definition: TableDefinition): Promise<void> {
  await database.execAsync(createTableSql(name, definition));
  for (const index of definition.indexes ?? []) {
    await database.execAsync(index);
  }
}

/** Adds columns introduced after a persistent table was first created (it is never dropped). */
async function migratePersistentTables(database: LocalDatabase): Promise<void> {
  for (const [name, definition] of Object.entries(PERSISTENT_TABLES) as Array<[string, TableDefinition]>) {
    await createTable(database, name, definition);
    const existing = await getColumnNames(database, name);
    for (const [column, columnDefinition] of definition.columns) {
      if (!existing.has(column)) {
        await database.execAsync(`ALTER TABLE ${name} ADD COLUMN ${column} ${columnDefinition};`);
      }
    }
  }
}

export async function initialiseSchema(database: LocalDatabase): Promise<void> {
  await migratePersistentTables(database);

  const versionRow = await database.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?;', [
    SCHEMA_VERSION_META_KEY,
  ]);
  const currentVersion = versionRow ? Number(versionRow.value) : null;

  if (currentVersion === LOCAL_SCHEMA_VERSION) {
    await database.transaction(async (tx) => {
      let catalogChanged = false;
      for (const [name, definition] of Object.entries(CACHE_TABLES) as Array<[string, TableDefinition]>) {
        await createTable(tx, name, definition);
        const existing = await getColumnNames(tx, name);
        for (const [column, columnDefinition] of definition.columns) {
          if (!existing.has(column)) {
            await tx.execAsync(`ALTER TABLE ${name} ADD COLUMN ${column} ${columnDefinition};`);
            catalogChanged ||= CATALOG_TABLES.has(name);
          }
        }
      }
      // Rows cached before a catalog column existed hold its default, not the server value. Keep them
      // for offline use, but mark every bundle stale so the next online open refetches it.
      if (catalogChanged) {
        await tx.runAsync('UPDATE festivals SET bundle_version = 0 WHERE bundle_version IS NOT NULL;');
      }
    });
    return;
  }

  // Version bump (or first launch): rebuild every cache table. The app refetches on launch.
  await database.transaction(async (tx) => {
    for (const name of Object.keys(CACHE_TABLES)) {
      await tx.execAsync(`DROP TABLE IF EXISTS ${name};`);
    }
    for (const [name, definition] of Object.entries(CACHE_TABLES) as Array<[string, TableDefinition]>) {
      await createTable(tx, name, definition);
    }
    await tx.runAsync('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;', [
      SCHEMA_VERSION_META_KEY,
      String(LOCAL_SCHEMA_VERSION),
    ]);
  });
}

export async function getDb(): Promise<LocalDatabase> {
  if (!databasePromise) {
    const factory = databaseFactoryOverride ?? defaultDatabaseFactory;
    if (!factory) {
      throw new Error('No local database factory is configured.');
    }

    const opening = (async () => {
      const database = await factory();
      await initialiseSchema(database);
      return database;
    })();
    databasePromise = opening;
    // A failed open must not poison every later call.
    opening.catch(() => {
      if (databasePromise === opening) {
        databasePromise = null;
      }
    });
  }

  return databasePromise;
}

export async function withDbTransaction<T>(callback: (db: LocalDatabase) => Promise<T>): Promise<T> {
  const database = await getDb();
  return database.transaction(callback);
}

export function setDatabaseFactoryForTests(factory: DatabaseFactory): void {
  databaseFactoryOverride = factory;
  databasePromise = null;
}

export function resetDbForTests(): void {
  databaseFactoryOverride = null;
  databasePromise = null;
}

export function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return identifier;
}

/**
 * Inserts or updates rows by the table's primary key. Only columns that exist in the local schema
 * are written (server-only or embedded fields are ignored); columns absent from a row keep their
 * current value on update.
 */
export async function upsertRows(table: string, rows: Array<Record<string, unknown>>, db?: LocalDatabase): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const database = db ?? (await getDb());
  const safeTable = quoteIdentifier(table);
  const knownColumns = getTableColumns(table);
  const primaryKey = getPrimaryKey(table);

  for (const row of rows) {
    const columns = Object.keys(row).filter((column) => row[column] !== undefined && (!knownColumns || knownColumns.has(column)));
    if (columns.length === 0) {
      continue;
    }

    const safeColumns = columns.map(quoteIdentifier);
    const placeholders = columns.map(() => '?').join(', ');
    const updates = safeColumns.filter((column) => !primaryKey.includes(column)).map((column) => `${column}=excluded.${column}`);
    const conflict = updates.length > 0 ? `DO UPDATE SET ${updates.join(', ')}` : 'DO NOTHING';
    const sql = `INSERT INTO ${safeTable} (${safeColumns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${primaryKey.join(', ')}) ${conflict};`;
    await database.runAsync(
      sql,
      columns.map((column) => toSqlValue(row[column])),
    );
  }
}

export async function replaceRowsForFestival(
  table: 'stages' | 'sets',
  festivalId: string,
  rows: Array<Record<string, unknown>>,
  db?: LocalDatabase,
): Promise<void> {
  const database = db ?? (await getDb());
  await database.runAsync(`DELETE FROM ${table} WHERE festival_id = ?;`, [festivalId]);
  await upsertRows(table, rows, database);
}

export async function setMeta(key: string, value: string, db?: LocalDatabase): Promise<void> {
  await upsertRows('app_meta', [{ key, value }], db);
}

export async function getMeta(key: string, db?: LocalDatabase): Promise<string | null> {
  const database = db ?? (await getDb());
  const row = await database.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?;', [key]);
  return row?.value ?? null;
}

export async function deleteMeta(key: string, db?: LocalDatabase): Promise<void> {
  const database = db ?? (await getDb());
  await database.runAsync('DELETE FROM app_meta WHERE key = ?;', [key]);
}


/**
 * Local SQLite schema.
 *
 * Cache tables mirror the server rows the app renders offline. A column appended to a cache table
 * is added in place on the next launch, so an app update never empties the offline cache (a new
 * catalog column also marks every cached festival bundle stale, so it is refetched once online).
 * Append new columns with a default or as nullable. Bump `LOCAL_SCHEMA_VERSION` only for changes
 * that cannot be made in place (a removed, renamed or retyped column, or a new primary key): that
 * drops and recreates every cache table on the next launch and the app refetches. The persistent
 * tables (`sync_queue`, `sync_failures`, `app_meta`) always survive and are migrated in place.
 */

export const LOCAL_SCHEMA_VERSION = 2;
export const SCHEMA_VERSION_META_KEY = 'schema_version';

export interface TableDefinition {
  columns: ReadonlyArray<readonly [name: string, definition: string]>;
  primaryKey: readonly string[];
  indexes?: readonly string[];
}

export const CACHE_TABLES = {
  users: {
    columns: [
      ['id', 'TEXT NOT NULL'],
      ['display_name', 'TEXT NOT NULL'],
      ['avatar_type', "TEXT NOT NULL DEFAULT 'initials'"],
      ['avatar_value', "TEXT NOT NULL DEFAULT ''"],
      ['created_at', 'TEXT'],
    ],
    primaryKey: ['id'],
  },
  festivals: {
    columns: [
      ['id', 'TEXT NOT NULL'],
      ['name', 'TEXT NOT NULL'],
      ['start_date', 'TEXT NOT NULL'],
      ['end_date', 'TEXT NOT NULL'],
      ['timezone', 'TEXT NOT NULL'],
      ['venue_name', 'TEXT'],
      ['accent_color', 'TEXT'],
      ['image_url', 'TEXT'],
      ['map_asset_url', 'TEXT'],
      ['version', 'INTEGER NOT NULL DEFAULT 1'],
      ['status', "TEXT NOT NULL DEFAULT 'published'"],
      ['is_demo', 'INTEGER NOT NULL DEFAULT 0'],
      ['latitude', 'REAL'],
      ['longitude', 'REAL'],
      ['default_zoom', 'REAL'],
      ['bounds_sw_lat', 'REAL'],
      ['bounds_sw_lng', 'REAL'],
      ['bounds_ne_lat', 'REAL'],
      ['bounds_ne_lng', 'REAL'],
      ['source_url', 'TEXT'],
      ['updated_at', 'TEXT'],
      // Local only: `version` of the stages/sets/artists bundle cached for this festival.
      ['bundle_version', 'INTEGER'],
    ],
    primaryKey: ['id'],
  },
  stages: {
    columns: [
      ['id', 'TEXT NOT NULL'],
      ['festival_id', 'TEXT NOT NULL'],
      ['name', 'TEXT NOT NULL'],
      ['zone', 'TEXT'],
      ['latitude', 'REAL'],
      ['longitude', 'REAL'],
    ],
    primaryKey: ['id'],
    indexes: ['CREATE INDEX IF NOT EXISTS stages_festival_idx ON stages (festival_id);'],
  },
  artists: {
    columns: [
      ['id', 'TEXT NOT NULL'],
      ['name', 'TEXT NOT NULL'],
      ['image_url', 'TEXT'],
      ['genre', 'TEXT'],
    ],
    primaryKey: ['id'],
  },
  sets: {
    columns: [
      ['id', 'TEXT NOT NULL'],
      ['festival_id', 'TEXT NOT NULL'],
      ['artist_id', 'TEXT NOT NULL'],
      ['stage_id', 'TEXT NOT NULL'],
      ['start_time', 'TEXT NOT NULL'],
      ['end_time', 'TEXT NOT NULL'],
      ['set_type', "TEXT NOT NULL DEFAULT 'performance'"],
      // 'scheduled' | 'moved' | 'cancelled' (server migration 011).
      ['status', "TEXT NOT NULL DEFAULT 'scheduled'"],
      ['original_start_time', 'TEXT'],
      ['change_note', 'TEXT'],
    ],
    primaryKey: ['id'],
    indexes: ['CREATE INDEX IF NOT EXISTS sets_festival_idx ON sets (festival_id, start_time);'],
  },
  user_festivals: {
    columns: [
      ['id', 'TEXT NOT NULL'],
      ['user_id', 'TEXT NOT NULL'],
      ['festival_id', 'TEXT NOT NULL'],
      ['selected_at', 'TEXT NOT NULL'],
    ],
    primaryKey: ['id'],
    indexes: ['CREATE INDEX IF NOT EXISTS user_festivals_user_idx ON user_festivals (user_id);'],
  },
  user_set_selections: {
    columns: [
      ['id', 'TEXT NOT NULL'],
      ['user_id', 'TEXT NOT NULL'],
      ['festival_id', 'TEXT NOT NULL'],
      ['set_id', 'TEXT NOT NULL'],
      ['selected_at', 'TEXT NOT NULL'],
      ['note', 'TEXT'],
      ['pending_sync', 'INTEGER NOT NULL DEFAULT 0'],
      ['synced_at', 'TEXT'],
    ],
    primaryKey: ['id'],
    indexes: ['CREATE INDEX IF NOT EXISTS user_set_selections_user_idx ON user_set_selections (user_id, festival_id, set_id);'],
  },
  groups: {
    columns: [
      ['id', 'TEXT NOT NULL'],
      ['festival_id', 'TEXT NOT NULL'],
      ['name', 'TEXT NOT NULL'],
      ['created_by_user_id', 'TEXT'],
      ['invite_code', 'TEXT NOT NULL'],
      ['invite_code_rotated_at', 'TEXT'],
      ['created_at', 'TEXT NOT NULL'],
    ],
    primaryKey: ['id'],
  },
  group_members: {
    columns: [
      ['id', 'TEXT NOT NULL'],
      ['group_id', 'TEXT NOT NULL'],
      ['user_id', 'TEXT NOT NULL'],
      ['role', "TEXT NOT NULL DEFAULT 'member'"],
      ['joined_at', 'TEXT NOT NULL'],
    ],
    primaryKey: ['id'],
    indexes: [
      'CREATE INDEX IF NOT EXISTS group_members_group_idx ON group_members (group_id);',
      'CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members (user_id);',
    ],
  },
  meetups: {
    columns: [
      ['id', 'TEXT NOT NULL'],
      ['group_id', 'TEXT NOT NULL'],
      ['title', 'TEXT NOT NULL'],
      ['stage_id', 'TEXT'],
      ['starts_at', 'TEXT NOT NULL'],
      ['notes', 'TEXT'],
      ['latitude', 'REAL'],
      ['longitude', 'REAL'],
      ['totem_path', 'TEXT'],
      ['created_by_user_id', 'TEXT NOT NULL'],
      ['created_at', 'TEXT'],
      ['updated_at', 'TEXT'],
      ['pending_sync', 'INTEGER NOT NULL DEFAULT 0'],
      ['synced_at', 'TEXT'],
    ],
    primaryKey: ['id'],
    indexes: ['CREATE INDEX IF NOT EXISTS meetups_group_idx ON meetups (group_id, starts_at);'],
  },
  user_blocks: {
    columns: [
      ['blocked_id', 'TEXT NOT NULL'],
      ['created_at', 'TEXT'],
    ],
    primaryKey: ['blocked_id'],
  },
} as const satisfies Record<string, TableDefinition>;

/** Festival catalog tables, refreshed per festival bundle (`festivals.bundle_version`). */
export const CATALOG_TABLES: ReadonlySet<string> = new Set(['festivals', 'stages', 'sets', 'artists']);

export const PERSISTENT_TABLES = {
  sync_queue: {
    columns: [
      ['id', 'TEXT NOT NULL'],
      ['table_name', 'TEXT NOT NULL'],
      ['operation_type', 'TEXT NOT NULL'],
      ['payload_json', 'TEXT NOT NULL'],
      ['attempt_count', 'INTEGER NOT NULL DEFAULT 0'],
      ['next_retry_at', 'TEXT'],
      ['last_error', 'TEXT'],
      ['created_at', 'TEXT NOT NULL'],
      ['pending_sync', 'INTEGER NOT NULL DEFAULT 1'],
      // v2 additions (added in place to v1 queues by `migratePersistentTables`).
      ['record_id', 'TEXT'],
      ['record_key', 'TEXT'],
      ['previous_json', 'TEXT'],
      ['parked', 'INTEGER NOT NULL DEFAULT 0'],
      ['seq', 'INTEGER NOT NULL DEFAULT 0'],
    ],
    primaryKey: ['id'],
  },
  sync_failures: {
    columns: [
      ['id', 'TEXT NOT NULL'],
      ['table_name', 'TEXT NOT NULL'],
      ['operation_type', 'TEXT NOT NULL'],
      ['record_id', 'TEXT'],
      ['payload_json', 'TEXT NOT NULL'],
      ['error_code', 'TEXT'],
      ['error_message', 'TEXT'],
      ['failed_at', 'TEXT NOT NULL'],
    ],
    primaryKey: ['id'],
  },
  app_meta: {
    columns: [
      ['key', 'TEXT NOT NULL'],
      ['value', 'TEXT NOT NULL'],
    ],
    primaryKey: ['key'],
  },
} as const satisfies Record<string, TableDefinition>;

export type CacheTableName = keyof typeof CACHE_TABLES;
export type PersistentTableName = keyof typeof PERSISTENT_TABLES;
export type LocalTableName = CacheTableName | PersistentTableName;

export const ALL_TABLES: Record<LocalTableName, TableDefinition> = { ...CACHE_TABLES, ...PERSISTENT_TABLES };

/** Tables holding data that belongs to the signed-in user (wiped by `clearLocalUserData`). */
export const USER_DATA_TABLES: readonly LocalTableName[] = [
  'users',
  'user_festivals',
  'user_set_selections',
  'groups',
  'group_members',
  'meetups',
  'user_blocks',
  'sync_queue',
  'sync_failures',
];

export function createTableSql(name: string, definition: TableDefinition): string {
  const columns = definition.columns.map(([column, columnDefinition]) => `${column} ${columnDefinition}`);
  columns.push(`PRIMARY KEY (${definition.primaryKey.join(', ')})`);
  return `CREATE TABLE IF NOT EXISTS ${name} (\n  ${columns.join(',\n  ')}\n);`;
}

export function getTableColumns(table: string): ReadonlySet<string> | null {
  const definition = (ALL_TABLES as Record<string, TableDefinition | undefined>)[table];
  return definition ? new Set(definition.columns.map(([column]) => column)) : null;
}

export function getPrimaryKey(table: string): readonly string[] {
  const definition = (ALL_TABLES as Record<string, TableDefinition | undefined>)[table];
  return definition?.primaryKey ?? ['id'];
}

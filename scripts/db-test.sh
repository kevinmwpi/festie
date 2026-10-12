#!/usr/bin/env bash
# Database test harness (docs/v1-architecture.md §7 gate 3).
#
#   npm run db:test
#
# Without DATABASE_URL: creates a throwaway Postgres 16 cluster (bootstrap
# superuser "supabase_admin") in a temp directory on a free localhost port,
# owned by an unprivileged OS user, and removes it on exit.
#
# With DATABASE_URL (CI): connects to that server as a superuser. The server's
# bootstrap superuser must NOT be named "postgres" (use
# POSTGRES_USER=supabase_admin for the postgres Docker image) because the
# migrations must run as a non-superuser "postgres" role, as on hosted
# Supabase. Each run uses fresh, uniquely named databases that are dropped on
# exit.
#
# Scenarios:
#   main            001..006 -> dirty fixture -> 007..013 -> checks -> rls.sql
#                   -> re-apply 007..013 -> checks -> rls.sql
#   only-005-rate   001..005_rate_limiting (no 006) -> 007..013 -> rls.sql
#   only-005-theme  001..004 + 006 (no 005_rate_limiting) -> 007..013 -> rls.sql
#                   -> two-session races (concurrent admin departure, 50-member cap)
#
# Exits non-zero on any SQL error, failed assertion or pgTAP plan mismatch.

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"
TESTS_DIR="$ROOT_DIR/supabase/tests"
LOCAL_DIR="$TESTS_DIR/local"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DB_TEST_OS_USER="${DB_TEST_OS_USER:-festie_dbtest}"
RUN_ID="$(date +%s)_$$"

if [[ -t 1 ]]; then
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_GREEN=''; C_RED=''; C_DIM=''; C_BOLD=''; C_RESET=''
fi

SUMMARY=()
TMP_DIR=''
LOG_DIR=''
CLUSTER_STARTED=0
CREATED_DBS=()
CONN_ARGS=()

log() { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$C_BOLD" "$C_RESET" "$*"; }
pass_line() { SUMMARY+=("${C_GREEN}PASS${C_RESET} $*"); printf '    %sok%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }

fail() {
  printf '\n%sFAIL%s %s\n' "$C_RED" "$C_RESET" "$*" >&2
  print_summary >&2
  exit 1
}

print_summary() {
  if ((${#SUMMARY[@]} > 0)); then
    printf '\n%sSummary%s\n' "$C_BOLD" "$C_RESET"
    printf '  %s\n' "${SUMMARY[@]}"
  fi
}

as_db_user() {
  if [[ "$(id -u)" == "0" ]]; then
    runuser -u "$DB_TEST_OS_USER" -- "$@"
  else
    "$@"
  fi
}

cleanup() {
  local status=$?
  set +e
  if [[ -n "${DATABASE_URL:-}" ]]; then
    for db in "${CREATED_DBS[@]}"; do
      admin_psql -q -v ON_ERROR_STOP=0 -c "drop database if exists \"$db\" with (force)" >/dev/null 2>&1
    done
  fi
  if ((CLUSTER_STARTED)); then
    as_db_user "$PG_BIN/pg_ctl" -D "$TMP_DIR/data" -m immediate -w stop >/dev/null 2>&1
  fi
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
  if [[ -n "$LOG_DIR" && -d "$LOG_DIR" ]]; then
    rm -rf "$LOG_DIR"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

command -v psql >/dev/null 2>&1 || fail "psql is not on PATH"

free_port() {
  if command -v node >/dev/null 2>&1; then
    node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();});'
  else
    python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()'
  fi
}

start_local_cluster() {
  [[ -x "$PG_BIN/initdb" ]] || fail "Postgres binaries not found in $PG_BIN (set PG_BIN or DATABASE_URL)"

  if [[ "$(id -u)" == "0" ]]; then
    if ! id -u "$DB_TEST_OS_USER" >/dev/null 2>&1; then
      useradd --system --no-create-home --shell /usr/sbin/nologin "$DB_TEST_OS_USER" \
        || fail "could not create OS user $DB_TEST_OS_USER"
    fi
  fi

  TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/festie-db-test.XXXXXX")"
  chmod 755 "$TMP_DIR"
  mkdir -p "$TMP_DIR/data" "$TMP_DIR/socket"
  if [[ "$(id -u)" == "0" ]]; then
    chown -R "$DB_TEST_OS_USER" "$TMP_DIR"
  fi

  local port
  port="$(free_port)"

  as_db_user "$PG_BIN/initdb" -D "$TMP_DIR/data" -U supabase_admin --auth=trust \
    --encoding=UTF8 --locale=C.UTF-8 >"$TMP_DIR/initdb.log" 2>&1 \
    || { cat "$TMP_DIR/initdb.log" >&2; fail "initdb failed"; }

  as_db_user "$PG_BIN/pg_ctl" -D "$TMP_DIR/data" -l "$TMP_DIR/postgres.log" -w -t 60 \
    -o "-p $port -k $TMP_DIR/socket -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c timezone=UTC" \
    start >/dev/null \
    || { cat "$TMP_DIR/postgres.log" >&2; fail "could not start Postgres"; }
  CLUSTER_STARTED=1

  CONN_ARGS=(-h 127.0.0.1 -p "$port" -U supabase_admin)
  pass_line "throwaway Postgres $("$PG_BIN/postgres" --version | awk '{print $3}') cluster on 127.0.0.1:$port"
}

# psql against the maintenance database as the superuser.
admin_psql() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" -X "$@"
  else
    psql "${CONN_ARGS[@]}" -d postgres -X "$@"
  fi
}

# psql against a scenario database as the superuser.
db_psql() {
  local db="$1"
  shift
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$(db_url "$db")" -X -v ON_ERROR_STOP=1 "$@"
  else
    psql "${CONN_ARGS[@]}" -d "$db" -X -v ON_ERROR_STOP=1 "$@"
  fi
}

db_url() {
  # Swap the database name of DATABASE_URL, keeping credentials and options.
  node -e '
    const u = new URL(process.argv[1]);
    u.pathname = "/" + encodeURIComponent(process.argv[2]);
    console.log(u.toString());
  ' "$DATABASE_URL" "$1"
}

create_db() {
  local db="$1"
  admin_psql -q -v ON_ERROR_STOP=1 -c "create database \"$db\"" >/dev/null \
    || fail "could not create database $db"
  CREATED_DBS+=("$db")
  local out
  out="$(db_psql "$db" -q -f "$LOCAL_DIR/supabase-stubs.sql" 2>&1)" \
    || { printf '%s\n' "$out" >&2; fail "[$db] supabase-stubs.sql failed"; }
}

# Applies one migration as the non-superuser "postgres" role in one transaction, with
# search_path = public: `supabase db push` does not put the extensions schema on the path, so a
# migration that calls an extension function unqualified must set its own search_path.
apply_migration() {
  local db="$1" file="$2" label="${3:-}"
  local out
  out="$(db_psql "$db" -q --single-transaction \
    -c "set session authorization postgres" \
    -c "set search_path = public" \
    -f "$file" 2>&1)" \
    || { printf '%s\n' "$out" >&2; fail "[$db] migration $(basename "$file")${label:+ ($label)} failed"; }
  if grep -q 'WARNING' <<<"$out"; then
    printf '%s\n' "$out" | grep 'WARNING' | sed 's/^/      /'
  fi
}

apply_superuser_file() {
  local db="$1" file="$2"
  local out
  out="$(db_psql "$db" -q --single-transaction -f "$file" 2>&1)" \
    || { printf '%s\n' "$out" >&2; fail "[$db] $(basename "$file") failed"; }
}

# Runs a pgTAP file and verifies: no SQL error, no "not ok", run count == plan.
run_tap() {
  local db="$1" file="$2" label="$3"
  local out status=0
  out="$(db_psql "$db" -q -A -t -f "$file" 2>&1)" || status=$?

  local planned ran failed
  planned="$(grep -E '^1\.\.[0-9]+$' <<<"$out" | head -n1 | cut -d. -f3 || true)"
  ran="$(grep -cE '^(not )?ok [0-9]+' <<<"$out" || true)"
  failed="$(grep -cE '^not ok [0-9]+' <<<"$out" || true)"

  if ((status != 0)); then
    printf '%s\n' "$out" | tail -n 40 >&2
    fail "[$db] $label: SQL error (psql exit $status) after $ran assertions"
  fi
  if [[ -z "$planned" ]]; then
    printf '%s\n' "$out" | tail -n 20 >&2
    fail "[$db] $label: no TAP plan found"
  fi
  if ((failed > 0)); then
    printf '%s\n' "$out" | grep -E -A6 '^not ok' >&2
    fail "[$db] $label: $failed of $ran assertions failed"
  fi
  if ((ran != planned)); then
    printf '%s\n' "$out" | grep -E '^#' >&2 || true
    fail "[$db] $label: planned $planned assertions but ran $ran"
  fi
  if grep -qE '^# Looks like' <<<"$out"; then
    printf '%s\n' "$out" | grep -E '^#' >&2
    fail "[$db] $label: pgTAP reported a problem"
  fi
  pass_line "[$db] $label: $ran/$planned assertions"
}

# Two real sessions racing through the group-lock code paths: both admins of a
# group leave at once, and two users join a 49-member group at once.
run_races() {
  local db="$1"
  apply_superuser_file "$db" "$LOCAL_DIR/race-setup.sql"

  local pid status_a=0 status_b=0
  db_psql "$db" -q -f "$LOCAL_DIR/race-leave-1.sql" >"$LOG_DIR/leave-1.log" 2>&1 &
  pid=$!
  sleep 0.5
  db_psql "$db" -q -f "$LOCAL_DIR/race-leave-2.sql" >"$LOG_DIR/leave-2.log" 2>&1 || status_b=$?
  wait "$pid" || status_a=$?
  if ((status_a != 0 || status_b != 0)); then
    cat "$LOG_DIR/leave-1.log" "$LOG_DIR/leave-2.log" >&2
    fail "[$db] concurrent leave_group sessions failed"
  fi

  status_a=0
  status_b=0
  db_psql "$db" -q -f "$LOCAL_DIR/race-join-4.sql" >"$LOG_DIR/join-4.log" 2>&1 &
  pid=$!
  sleep 0.5
  db_psql "$db" -q -f "$LOCAL_DIR/race-join-5.sql" >"$LOG_DIR/join-5.log" 2>&1 || status_b=$?
  wait "$pid" || status_a=$?
  # Exactly one join must succeed; the other must fail with group_full.
  if ! { ((status_a == 0 && status_b != 0)) && grep -q 'group_full' "$LOG_DIR/join-5.log"; } \
    && ! { ((status_b == 0 && status_a != 0)) && grep -q 'group_full' "$LOG_DIR/join-4.log"; }; then
    cat "$LOG_DIR/join-4.log" "$LOG_DIR/join-5.log" >&2
    fail "[$db] concurrent join_group: expected one success and one group_full"
  fi

  run_tap "$db" "$LOCAL_DIR/race-checks.sql" "concurrency races (admin hand-off, 50-member cap)"
}

migration_files() {
  # Echo migration paths in order, filtered by an optional exclusion list.
  local exclude=("$@")
  local f base skip
  for f in "$MIGRATIONS_DIR"/*.sql; do
    base="$(basename "$f")"
    skip=0
    for e in "${exclude[@]}"; do
      [[ "$base" == "$e" ]] && skip=1
    done
    ((skip)) || printf '%s\n' "$f"
  done
}

main() {
  step "Database tests"
  LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/festie-db-test-logs.XXXXXX")"

  local required=(
    001_initial_schema.sql 002_rls.sql 003_supporting_tables.sql 004_security_hardening.sql
    005_rate_limiting.sql 006_user_festivals_and_festival_theme.sql 007_v1_security_overhaul.sql
    008_storage_totems.sql 009_seed_moderation_terms.sql 010_foreign_key_indexes.sql
    011_set_status.sql 012_image_credits_and_suggestions.sql 013_storage_artwork.sql
  )
  for m in "${required[@]}"; do
    [[ -f "$MIGRATIONS_DIR/$m" ]] || fail "missing migration $m"
  done
  if [[ -e "$MIGRATIONS_DIR/005_user_festivals_and_festival_theme.sql" ]]; then
    fail "legacy 005_user_festivals_and_festival_theme.sql must be removed (renamed to 006)"
  fi

  step "Storage SQL guard"
  if grep -nEi 'alter table storage\.|create (or replace )?function storage\.|delete from storage\.' "$MIGRATIONS_DIR"/*.sql; then
    fail "migrations contain forbidden storage.* DDL/DML (see §2.1)"
  fi
  pass_line "no forbidden storage.* statements in migrations"

  if [[ -n "${DATABASE_URL:-}" ]]; then
    command -v node >/dev/null 2>&1 || fail "node is required to derive per-scenario database URLs"
    admin_psql -q -v ON_ERROR_STOP=1 -c 'select 1' >/dev/null \
      || fail "cannot connect to DATABASE_URL"
    local is_super
    is_super="$(admin_psql -A -t -c "select rolsuper from pg_roles where rolname = current_user")"
    [[ "$is_super" == "t" ]] || fail "DATABASE_URL must connect as a superuser"
    pass_line "using DATABASE_URL server"
  else
    step "Starting throwaway cluster"
    start_local_cluster
  fi

  local m

  # ------------------------------------------------------------------ main
  local db_main="festie_main_$RUN_ID"
  step "Scenario main ($db_main)"
  create_db "$db_main"
  for m in 001_initial_schema.sql 002_rls.sql 003_supporting_tables.sql 004_security_hardening.sql \
    005_rate_limiting.sql 006_user_festivals_and_festival_theme.sql; do
    apply_migration "$db_main" "$MIGRATIONS_DIR/$m"
  done
  apply_superuser_file "$db_main" "$LOCAL_DIR/dirty-fixture.sql"
  pass_line "[$db_main] 001-006 + dirty fixture applied"
  for m in 007_v1_security_overhaul.sql 008_storage_totems.sql 009_seed_moderation_terms.sql 010_foreign_key_indexes.sql \
    011_set_status.sql 012_image_credits_and_suggestions.sql 013_storage_artwork.sql; do
    apply_migration "$db_main" "$MIGRATIONS_DIR/$m"
  done
  pass_line "[$db_main] 007-013 applied as postgres"
  run_tap "$db_main" "$LOCAL_DIR/dirty-fixture-checks.sql" "dirty fixture repaired"
  run_tap "$db_main" "$TESTS_DIR/rls.sql" "rls.sql"

  step "Re-applying 007-013 (idempotency)"
  for m in 007_v1_security_overhaul.sql 008_storage_totems.sql 009_seed_moderation_terms.sql 010_foreign_key_indexes.sql \
    011_set_status.sql 012_image_credits_and_suggestions.sql 013_storage_artwork.sql; do
    apply_migration "$db_main" "$MIGRATIONS_DIR/$m" "re-apply"
  done
  pass_line "[$db_main] 007-013 re-applied"
  run_tap "$db_main" "$LOCAL_DIR/dirty-fixture-checks.sql" "dirty fixture repaired (after re-apply)"
  run_tap "$db_main" "$TESTS_DIR/rls.sql" "rls.sql (after re-apply)"

  # ----------------------------------------------- hosted variant: no 006
  local db_rate="festie_only_rate_$RUN_ID"
  step "Scenario only-005-rate ($db_rate): hosted DB that never ran the user_festivals 005"
  create_db "$db_rate"
  while IFS= read -r m; do
    apply_migration "$db_rate" "$m"
  done < <(migration_files 006_user_festivals_and_festival_theme.sql)
  pass_line "[$db_rate] 001-005_rate_limiting + 007-013 applied"
  run_tap "$db_rate" "$TESTS_DIR/rls.sql" "rls.sql"

  # ------------------------------------- hosted variant: no rate limiting
  local db_theme="festie_only_theme_$RUN_ID"
  step "Scenario only-005-theme ($db_theme): hosted DB that never ran 005_rate_limiting"
  create_db "$db_theme"
  while IFS= read -r m; do
    apply_migration "$db_theme" "$m"
  done < <(migration_files 005_rate_limiting.sql)
  pass_line "[$db_theme] 001-004 + 006-013 applied"
  run_tap "$db_theme" "$TESTS_DIR/rls.sql" "rls.sql"

  step "Concurrency races ($db_theme)"
  run_races "$db_theme"

  print_summary
  printf '\n%sAll database tests passed.%s\n' "$C_GREEN" "$C_RESET"
}

main "$@"

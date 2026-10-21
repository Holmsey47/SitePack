#!/usr/bin/env bash
# Throwaway Postgres only. Does not touch a hosted Supabase project.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
port="${JOIN_PROBE_PORT:-54329}"
name="${JOIN_PROBE_CONTAINER:-sitepack-join-probe}"
migration="$root/supabase/migrations/20261021210000_join_codes.sql"

cleanup() {
  if [[ "${PROBE_MODE:-}" == "docker" ]]; then
    docker rm -f "$name" >/dev/null 2>&1 || true
  elif [[ "${PROBE_MODE:-}" == "local" && -n "${PROBE_DIR:-}" ]]; then
    pg_ctl -D "$PROBE_DIR" stop -m immediate >/dev/null 2>&1 || true
    rm -rf "$PROBE_DIR"
  fi
}
trap cleanup EXIT

if command -v docker >/dev/null 2>&1; then
  PROBE_MODE=docker
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_PASSWORD=postgres -p "127.0.0.1:${port}:5432" postgres:17 >/dev/null
  for _ in $(seq 1 60); do
    if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -c 'create database sitepack;'
  docker cp "$root/scripts/throwaway-auth.sql" "$name":/tmp/throwaway-auth.sql
  docker cp "$migration" "$name":/tmp/join_codes_migration.sql
  docker exec "$name" psql -U postgres -d sitepack -v ON_ERROR_STOP=1 -f /tmp/throwaway-auth.sql
  for file in "$root"/supabase/migrations/*.sql; do
    docker cp "$file" "$name":/tmp/migration-step.sql
    docker exec "$name" psql -U postgres -d sitepack -v ON_ERROR_STOP=1 -f /tmp/migration-step.sql
  done
  docker cp "$root/supabase/seed.sql" "$name":/tmp/seed.sql
  docker exec "$name" psql -U postgres -d sitepack -v ON_ERROR_STOP=1 -f /tmp/seed.sql
  docker cp "$root/scripts/join-codes.sql" "$name":/tmp/join-codes.sql
  docker exec "$name" psql -U postgres -d sitepack -v ON_ERROR_STOP=1 \
    -v migration=/tmp/join_codes_migration.sql \
    -v probe_conn='host=127.0.0.1 port=5432 dbname=sitepack user=postgres connect_timeout=5' \
    -f /tmp/join-codes.sql
else
  PROBE_MODE=local
  if ! command -v initdb >/dev/null 2>&1; then
    for bindir in /usr/lib/postgresql/*/bin; do
      if [[ -x "$bindir/initdb" ]]; then
        export PATH="$bindir:$PATH"
        break
      fi
    done
  fi
  if ! command -v initdb >/dev/null 2>&1; then
    echo "docker or initdb is required for the throwaway database" >&2
    exit 1
  fi
  PROBE_DIR="$(mktemp -d /tmp/sitepack-join-probe.XXXXXX)"
  initdb -D "$PROBE_DIR" --auth=trust --username=postgres >/dev/null
  cat > "$PROBE_DIR/pg_hba.conf" <<'EOF'
local all all trust
host all all 127.0.0.1/32 trust
host all all ::1/128 trust
EOF
  pg_ctl -D "$PROBE_DIR" -l "$PROBE_DIR/server.log" -o "-p ${port} -k ${PROBE_DIR} -c listen_addresses=127.0.0.1" start
  for _ in $(seq 1 60); do
    if pg_isready -h 127.0.0.1 -p "$port" -U postgres >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  psql_base=(psql -h 127.0.0.1 -p "$port" -U postgres -v ON_ERROR_STOP=1)
  "${psql_base[@]}" -d postgres -c 'create database sitepack;'
  "${psql_base[@]}" -d sitepack -f "$root/scripts/throwaway-auth.sql"
  for file in "$root"/supabase/migrations/*.sql; do
    "${psql_base[@]}" -d sitepack -f "$file"
  done
  "${psql_base[@]}" -d sitepack -f "$root/supabase/seed.sql"
  "${psql_base[@]}" -d sitepack \
    -v migration="$migration" \
    -v probe_conn="host=127.0.0.1 port=${port} dbname=sitepack user=postgres connect_timeout=5" \
    -f "$root/scripts/join-codes.sql"
fi

echo "join-code probes passed"

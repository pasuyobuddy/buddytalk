#!/usr/bin/env bash
# Runs the migrations + tests against a throwaway local Postgres database.
# Usage: PGHOST=/tmp PGPORT=54329 PGUSER=postgres ./supabase/tests/run_tests.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-chat_test}
P="psql -v ON_ERROR_STOP=1 -q -X"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB"
for f in tests/00_supabase_stub.sql migrations/*.sql tests/01_messaging_tests.sql; do
  echo "== $f"
  $P -d "$DB" -o /dev/null -f "$f" 2> >(grep -v -e wal_level -e 'HINT:' >&2)
done
$P -d "$DB" -c "select n, case when ok then 'PASS' else 'FAIL' end as result, name from tests.results order by n"
$P -d "$DB" -c "select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from tests.results"

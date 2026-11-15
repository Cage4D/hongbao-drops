#!/usr/bin/env bash
# Local dev/test Postgres in user space (no sudo): data in ~/.local/share/hongbao-drops/pgdata, port 54329.
# Usage: scripts/dev-db.sh start|stop|status
set -euo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
DATA="${HONGBAO_PGDATA:-$HOME/.local/share/hongbao-drops/pgdata}"
PORT="${HONGBAO_PGPORT:-54329}"
case "${1:-status}" in
  start)
    if [ ! -f "$DATA/PG_VERSION" ]; then
      mkdir -p "$DATA"
      "$BIN/initdb" -D "$DATA" -U hongbao --auth=trust >/dev/null
      echo "initialised $DATA"
    fi
    "$BIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -o "-p $PORT -k /tmp -c listen_addresses=localhost" -w start >/dev/null || true
    for db in hongbao hongbao_test; do
      psql -h localhost -p "$PORT" -U hongbao -d postgres -tc "select 1 from pg_database where datname='$db'" | grep -q 1 \
        || psql -h localhost -p "$PORT" -U hongbao -d postgres -qc "create database $db"
    done
    echo "postgres running on localhost:$PORT (dbs: hongbao, hongbao_test)"
    ;;
  stop) "$BIN/pg_ctl" -D "$DATA" -w stop ;;
  status) "$BIN/pg_ctl" -D "$DATA" status || true ;;
esac

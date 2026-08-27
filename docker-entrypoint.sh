#!/bin/sh
# Copy any seeded world into the container's own writable data dir.
#
# /seed is the host's ./data mounted READ-ONLY. It is read-only on purpose: a
# clock on the host may be mid-tick against those files, and a second writer on
# a SQLite world corrupts the one artefact here that cannot be regenerated.
# The container works on copies and can do whatever it likes to them.
set -e

if [ -d /seed ]; then
  for db in /seed/*.db; do
    [ -e "$db" ] || continue
    target="/app/data/$(basename "$db")"
    if [ ! -e "$target" ]; then
      cp "$db" "$target"
      # The -wal matters. These worlds run in WAL mode, so the most recent
      # commits live in the sidecar and NOT in the .db until a checkpoint.
      # Copying the .db alone silently seeded a world tens of events short of
      # the one on disk -- present, plausible, and quietly out of date, which
      # is the worst way for a history to be wrong.
      for side in "$db-wal" "$db-shm"; do
        [ -e "$side" ] && cp "$side" "/app/data/$(basename "$side")"
      done
      echo "seeded $(basename "$db") ($(du -h "$target" | cut -f1))"
    fi
  done
fi

exec "$@"

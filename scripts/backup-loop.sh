#!/bin/sh
# Project Toolkit - continuous backup loop for the `backup` compose service.
#
# Runs INSIDE postgres:17-alpine, therefore:
#   * plain /bin/sh (busybox ash) only - no bashisms, no `set -o pipefail`;
#   * pg_dump / pg_restore are available in the image already.
#
# Why this file exists:
#   The loop used to be inlined into docker-compose.yml as a `sh -c` block. The
#   non-ASCII text in it got corrupted by a GBK/UTF-8 round trip, the quoting
#   broke, and the whole `pg_dump` / `find` body silently became arguments of an
#   `echo`. The container started, exited 0, and never produced a single backup.
#   => EVERY log line and every comment below must stay pure ASCII (7-bit).
#      Do not add Chinese text, tabs, or fancy quotes to this file.
#
# Safety model:
#   * write to a hidden *.tmp file, verify it, then atomically `mv` into place;
#   * a verification failure leaves NO file that looks like a valid backup;
#   * every failure is reported to $BACKUP_DIR/LAST_FAILURE.txt so operators can
#     see the problem without digging through logs.
#
# Overridable via container environment (defaults are the compose values).
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
DATA_DIR=${DATA_DIR:-/data}
RETENTION_DAYS=${RETENTION_DAYS:-14}
TMP_MAX_AGE_DAYS=${TMP_MAX_AGE_DAYS:-2}
FAILURE_RETRY_SECONDS=${FAILURE_RETRY_SECONDS:-3600}
SUCCESS_INTERVAL_SECONDS=${SUCCESS_INTERVAL_SECONDS:-86400}
# A real custom-format dump of this schema is far bigger than 1 KiB; anything
# smaller means pg_dump wrote an error stub instead of a dump.
MIN_DUMP_BYTES=${MIN_DUMP_BYTES:-1024}

FAIL_REASON=""

# ---------------------------------------------------------------- logging ----
# Emit an ISO-8601 local timestamp with the colon form offset (+08:00), e.g.
#   2026-10-19T09:30:00+08:00
# busybox `date +%z` prints +0800, so the last two digits are re-formatted.
now() {
    _base=$(date +%Y-%m-%dT%H:%M:%S)
    _off=$(date +%z 2>/dev/null || true)
    if [ -n "$_off" ]; then
        # "+0800" -> "+08:00" (drop the last two digits, re-insert the colon)
        printf '%s%s:%s\n' "$_base" "${_off%??}" "${_off#???}"
    else
        printf '%s\n' "$_base"
    fi
}

log() {
    printf '[backup] %s %s\n' "$(now)" "$*"
}

# Portable byte size of a file; prints 0 when the file is unreadable.
size_of() {
    _size=$(wc -c < "$1" 2>/dev/null | tr -d ' ' || true)
    case "$_size" in
        ''|*[!0-9]*) _size=0 ;;
    esac
    printf '%s\n' "$_size"
}

# ------------------------------------------------------------- retention ----
# Delete artifacts older than $RETENTION_DAYS, plus stale temp/failed leftovers
# older than $TMP_MAX_AGE_DAYS. `find` may legitimately return non-zero (e.g. the
# directory is empty); never let that abort the loop.
cleanup_old_files() {
    find "$BACKUP_DIR" -type f -name 'pt_*.dump' -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
    find "$BACKUP_DIR" -type f -name 'pt_*.dump.gz' -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
    find "$BACKUP_DIR" -type f -name 'attachments_*.tar.gz' -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
    find "$BACKUP_DIR" -type f -name 'files_*.tar.gz' -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
    find "$BACKUP_DIR" -type f -name '*.tmp' -mtime "+${TMP_MAX_AGE_DAYS}" -delete 2>/dev/null || true
    find "$BACKUP_DIR" -type f -name '*.failed' -mtime "+${TMP_MAX_AGE_DAYS}" -delete 2>/dev/null || true
}

# --------------------------------------------------------------- failure ----
record_failure() {
    _reason=$1
    [ -n "$_reason" ] || _reason="unknown failure"
    log "ERROR: $_reason"
    # NOTE: keep this a SINGLE simple command. With a `{ ...; } > file` group a
    # failing redirection (EACCES / EROFS / EISDIR) kills the shell before the
    # group body runs, so `if !` never fires and the WARN below would be dead
    # code - and this file IS the human-visible failure signal, so a silently
    # dropped warning is exactly the bug class we are fixing.
    if ! printf 'time=%s\nreason=%s\nhint=check `docker compose logs backup` and that the db service is healthy\n' \
        "$(now)" "$_reason" > "$BACKUP_DIR/LAST_FAILURE.txt" 2>/dev/null; then
        log "WARN: could not write $BACKUP_DIR/LAST_FAILURE.txt"
    fi
}

# ----------------------------------------------------------- db dump step ----
# Dumps the database into $BACKUP_DIR/pt_<ts>.dump and verifies the artifact.
# Returns 0 only when a verified dump is on disk; sets FAIL_REASON otherwise.
dump_database() {
    ts=$1
    tmp="$BACKUP_DIR/.pt_${ts}.dump.tmp"
    final="$BACKUP_DIR/pt_${ts}.dump"

    log "INFO: database dump started -> $final"

    # -Fc already compresses; piping it through gzip again (the old behaviour)
    # produced a double-compressed file that pg_restore cannot read directly.
    if ! pg_dump -Fc -f "$tmp"; then
        FAIL_REASON="pg_dump exited non-zero"
        rm -f "$tmp"
        return 1
    fi

    if [ ! -f "$tmp" ]; then
        FAIL_REASON="pg_dump reported success but $tmp is missing"
        return 1
    fi

    bytes=$(size_of "$tmp")
    if [ "$bytes" -le "$MIN_DUMP_BYTES" ]; then
        FAIL_REASON="dump too small (${bytes} bytes, expected more than ${MIN_DUMP_BYTES})"
        rm -f "$tmp"
        return 1
    fi

    # Read the archive TOC: proves the file is a readable custom-format archive.
    if ! pg_restore -l "$tmp" > /dev/null 2>&1; then
        FAIL_REASON="pg_restore -l cannot read the produced archive"
        rm -f "$tmp"
        return 1
    fi

    # ... and prove it actually carries table data (an empty/stub archive would
    # pass the TOC read). `grep -c` exits 1 when the count is 0 -> `|| true`.
    tables=$(pg_restore -l "$tmp" | grep -c 'TABLE DATA' || true)
    case "$tables" in
        ''|*[!0-9]*) tables=0 ;;
    esac
    if [ "$tables" -lt 1 ]; then
        FAIL_REASON="archive contains no TABLE DATA entries"
        rm -f "$tmp"
        return 1
    fi

    # Atomic publish: readers never observe a partially written dump.
    if ! mv "$tmp" "$final"; then
        FAIL_REASON="cannot rename $tmp to $final"
        rm -f "$tmp"
        return 1
    fi

    log "OK: $final (${bytes} bytes, ${tables} table data entries)"
    return 0
}

# ---------------------------------------------------- attachments archive ----
# Optional: a failure here must NOT discard the verified database dump.
archive_attachments() {
    ts=$1
    src="$DATA_DIR/attachments"

    if [ ! -d "$src" ]; then
        log "INFO: $src not found, skipping attachment archive"
        return 0
    fi

    tmp="$BACKUP_DIR/.attachments_${ts}.tar.gz.tmp"
    final="$BACKUP_DIR/attachments_${ts}.tar.gz"

    if ! tar -czf "$tmp" -C "$DATA_DIR" attachments 2>/dev/null; then
        FAIL_REASON="tar failed while archiving $src"
        log "WARN: attachment archive failed, database dump is kept"
        rm -f "$tmp"
        return 1
    fi

    if ! tar -tzf "$tmp" > /dev/null 2>&1; then
        FAIL_REASON="attachment archive failed integrity check (tar -tzf)"
        log "WARN: attachment archive is unreadable, database dump is kept"
        rm -f "$tmp"
        return 1
    fi

    # A tarball with no entries is useless; an entry count (not a byte size) is
    # the right emptiness test, so a directory holding only tiny files is kept.
    entries=$(tar -tzf "$tmp" 2>/dev/null | wc -l | tr -d ' ')
    case "$entries" in
        ''|*[!0-9]*) entries=0 ;;
    esac
    if [ "$entries" -lt 1 ]; then
        log "INFO: attachment archive has no entries, discarded"
        rm -f "$tmp"
        return 0
    fi

    if ! mv "$tmp" "$final"; then
        FAIL_REASON="cannot rename $tmp to $final"
        log "WARN: cannot publish $final, database dump is kept"
        rm -f "$tmp"
        return 1
    fi

    bytes=$(size_of "$final")
    log "OK: $final (${bytes} bytes, ${entries} entries)"
    return 0
}

# ------------------------------------------------------------ one attempt ----
attempt_backup() {
    ts=$(date +%Y%m%d_%H%M%S)
    FAIL_REASON=""

    if ! dump_database "$ts"; then
        return 1
    fi

    # Attachments are best-effort: an archive problem does not invalidate the
    # database dump that was just published.
    archive_attachments "$ts" || true

    cleanup_old_files
    return 0
}

# ------------------------------------------------------------------ main ----
main() {
    mkdir -p "$BACKUP_DIR"
    log "INFO: backup loop started (dir=$BACKUP_DIR, retention=${RETENTION_DAYS}d, success_interval=${SUCCESS_INTERVAL_SECONDS}s, failure_retry=${FAILURE_RETRY_SECONDS}s)"

    while true; do
        if attempt_backup; then
            rm -f "$BACKUP_DIR/LAST_FAILURE.txt" 2>/dev/null || true
            log "INFO: sleeping ${SUCCESS_INTERVAL_SECONDS}s until next backup"
            sleep "$SUCCESS_INTERVAL_SECONDS"
        else
            record_failure "$FAIL_REASON"
            log "INFO: retrying in ${FAILURE_RETRY_SECONDS}s"
            sleep "$FAILURE_RETRY_SECONDS"
        fi
    done
}

main

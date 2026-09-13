# Staging thumbnail backfill (#521)

Preparation/rehearsal, stacked on thumbnail PR #520 (`4b0e181`), itself dependent
on pagination #518. This document supersedes the earlier **no backfill** scope
only for this separately authorized work. Eventual production rollout **must
include backfill**, but this tool rejects production; no production operation,
deployment, migration or maintenance window is authorized here.

**Current gate:** read-only staging inventory and real local encoding completed.
No remote mutation has been performed. Independent review of the exact head must
precede an explicitly approved staging pilot. The write switches below are not
approval by themselves. Do not deploy or push a deployment branch for this tool.

## Fixed contract

- Sources are the saved main PHOTO or the saved VIDEO POSTER, never a video body
  or an existing thumbnail. Keys mirror `lib/mediaCleanup.ts`: photo main
  `event-photos/{event}/{id}`, video source `event-videos/{event}/{id}-poster`,
  target sibling `-thumbnail`. Only target thumbnails may be PUT/DELETEd.
- Decode supported raster signatures locally with existing ImageMagick; never
  send media to external image processors. Orient as displayed, take the actual
  centered square (fractional offsets for odd dimensions), scale/upscale exactly
  320×320, strip metadata, WebP quality80 then50, JPEG fallback80 then50. Validate
  decoded dimensions, signature/MIME and 1..131072 bytes before mutation and on
  object readback. Video ISOBMFF signatures are not handed to a decoder.
- Inventory includes flag0 and flag1 rows, and classifies missing, legacy480,
  non-square, other-invalid and 320-square objects. Dimensions alone cannot prove
  center crop; only an exact locally regenerated hash/MIME plus flag1 permits
  `skip_compliant_hash`. An unproven 320 square is regenerated conservatively.
- Exclude missing/deleted users and missing events before asset reads/writes;
  missing posters/photos and decode failures are explicit skip/failure, not
  successes. Hidden rows retain their visibility. Only `has_thumbnail` is updated;
  originals, event/user flags, moderation, visibility and video bodies are untouched.
- Concurrency is **1**, batch default5, maximum25, source download maximum10MiB,
  request/encoder timeout45s, encoder memory/map limits and thread1. No load tests.
  Do not run another workspace/operator against overlapping targets.

## Setup and read-only rehearsal

Python3.11+ and existing ImageMagick7 are required; no pip/npm dependency added.
Use existing Wrangler login (or `CLOUDFLARE_API_TOKEN` in the process environment,
never an argument/file in git). The tool reads Wrangler's existing default OAuth
credential; it does not refresh it. If expired, refresh through an authorized
read-only Wrangler command with logs directed to the private workspace. REST calls
use the same account-scoped D1/R2 endpoints as Wrangler; they retain object MIME
and bytes without putting private response bodies in Wrangler's global logs.

From the repository root, choose a new **private directory outside every checkout**
on encrypted local storage, not a shared/synced directory:

```bash
umask 077
export BACKFILL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/thumbnail-rehearsal.XXXXXX")"
operator() {
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/thumbnail_backfill.py \
    --environment staging \
    --account b9cec3916d500760a7c7b9c31c720d80 \
    --database 389e4625-8e13-4a41-9530-3ab3be10cee5 \
    --bucket eventer-images-staging \
    --workspace "$BACKFILL_DIR" "$@"
}
operator --batch 5                 # default dry-run, no PUT/DELETE/UPDATE
# Repeat until inventory_complete=true; each invocation advances a durable cursor.
```

Targets are checked against pinned staging values, repository `wrangler.toml`,
remote DB UUID/name and bucket name in that account. Missing migration0089 fails
closed; it is never applied automatically. Production arguments are rejected
before credential access. D1 reads assert zero rows written.

The 0700 workspace is flocked; manifest/checkpoints are private, atomically replaced
and fsynced. Inventory is a cursor-based observation, not a global DB snapshot.
Apply rechecks rows and source/target bytes, so a stale inventory is not authority
to mutate. A changed source/row is skipped; re-inventory later in a **new** workspace
only after resolving the old journal. Do not edit status fields or delete a journal
to bypass reconciliation. Dry-run failure entries require investigation/new inventory.

## Reviewed pilot, resume, verification (NOT executed yet)

After independent exact-head review and explicit staging-write approval, reuse
the reviewed private manifest and the same encoder/tool head:

```bash
operator --mode apply --batch 1 --approve-staging-writes
operator --mode reconcile --batch 1 --approve-staging-writes
```

Inspect aggregate statuses and private evidence. Pilot a new photo thumbnail,
a replacement and a video-poster thumbnail before extending to batches of5; the
manifest is ordered by media ID, **not** media kind, so check the selected row
privately before each invocation. There is no claim the first three rows cover
all three cases. Do not manually reorder/edit the manifest for selection.

Each apply invocation resolves pending intents first and starts no new rows in
that invocation if any were pending. Successful rows are `verified`; repeated
apply skips them. Before expanding the pilot verify:

1. Journal saved old flag, old bytes/hash/HTTP metadata backup and intended output
   hash before first PUT; source/row/target identities were rechecked.
2. Direct R2 readback matches generated hash, MIME, size and decoded320×320;
   source identity still matches; then and only then flag CAS succeeded.
3. Final R2/row reads succeeded. Source hashes remain unchanged. Review private
   record and aggregate counts; never publish IDs, signed URLs or image bytes.
4. Use the authorized staging UI in a fresh browser context / disabled browser
   cache, or authenticated thumbnail request with a unique query parameter and
   `Cache-Control: no-cache`. Serving uses `private, max-age=3600`; existing browser
   entries may remain stale for an hour. Direct R2 API readback bypasses that cache
   and does **not** validate application visibility/auth. Verify event grid square,
   lightbox main photo, video playback/main poster unchanged, and access denial
   for an unauthorized user. Do not claim this UI check from local encoder tests.

After an interrupted process, lost response or failed request, **stop starting new
work**. Preserve the workspace and run reviewed reconciliation first:

```bash
operator --mode reconcile --batch 5 --approve-staging-writes
# Repeat to resolve all intent/rollback_intent entries, then scan all verified rows.
```

For verified rows the durable `reconcile_cursor` advances in bounded slices and
wraps to0. Pending intents always take priority. Finish a full verified-row sweep,
not just one invocation. An unexpected object hash or flag CAS conflict is a
stop/manual-review condition, never permission to overwrite someone else's work.

## Crash/deletion behavior and rollback

D1 and R2 are **not atomic**. Existing deletion paths remove D1 first and R2
best-effort afterward. This tool uses compensation, not an invented runtime lock:

- Durable `intent` + fsynced backup precede PUT. Lost PUT/CAS responses can be
  reconciled by exact output hash and current row/source identity.
- Recheck row/source after PUT; set flag only after verified object. Recheck object
  and row after CAS. If the row/user/event disappeared, delete only the known
  backfill object's hash, never restore deleted-user assets. Recovery also recognizes
  an old object restored during `rollback_intent` and removes that orphan.
- A process crash after PUT but before compensation can leave a **recoverable
  orphan** until resume. A later app deletion with failed R2 cleanup can also leave
  an orphan. Keep the journal available and reconcile; no zero-orphan/transactional
  guarantee is claimed. R2 check-then-write/delete is not CAS: overlapping external
  thumbnail writers are unsupported, including different local workspaces. Normal
  app deletion is handled, but a deliberately reused media ID is a manual conflict.
- Do not retry a transport error blindly. In particular do not clear a dangling
  flag after an uncertain PUT until direct object reads determine the outcome.

To roll back an approved pilot/batch, using the **same workspace**:

```bash
operator --mode rollback --batch 1 --approve-staging-writes
# Repeat for all verified/intent/rollback_intent entries needing rollback.
operator --mode reconcile --batch 5 --approve-staging-writes
```

Replacement rollback restores exact backup bytes and saved HTTP metadata, verifies
readback, then restores the original flag. A new variant clears its flag **before**
object deletion. If a pre-existing flag1 had no object, rollback restores absence
with flag0 rather than deliberately recreating a dangling flag. A deleted row/user
is never recreated; only owned orphan compensation is allowed. Rollback refuses
unknown hashes, corrupt/missing backups and CAS conflicts. Backups/journal must
survive interruptions. `rolled_back` entries are not automatically reapplied.

## Evidence and cleanup

Read-only staging observation: 23 rows, 12 photos (8 flag0/4 flag1), 11 videos
(all flag0), zero hidden/deleted-user rows.19 thumbnails absent; four JPEG variants
non-square (two360×480, two480×360), no proven compliant squares. All23 sources
present and decoded successfully:12 main photos +11 posters, no video body read.
Generated23 verified local320×320 WebPs, individual3,002–35,530B; totals216,376B
photos +102,902B posters. This is **dry-run readiness, not backfill completion**.

Normal completion/error removes each `media-*` temporary directory. SIGKILL may
leave one; after confirming no process owns the workspace lock, inspect and remove
only that workspace's temporary `media-*` directories (do not follow symlinks).
Retain manifest hashes/dimensions/MIME/counts. Keep backup files on encrypted local
storage until rollback is no longer needed and final reconciliation passes; then
remove those specific `backup-*` files. Never upload the manifest/backups/raw
Cloudflare output to git/GitHub. Unlinking on SSD is not forensic secure erasure;
use encrypted storage and its retention controls. Do not delete another operator's
workspace or use broad `/tmp` cleanup commands.

## Local checks and references

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts -p 'test_thumbnail_backfill.py' -v
```

Synthetic real-encoder checks and fake-D1/R2 fault injection cover crop/upscale,
MIME/signature, target/write rejection, object-before-flag, replacement restoration,
new-object rollback ordering, unknown PUT recovery, post-PUT/flag deletion,
source changes and recovery conflicts. They do not substitute for reviewed staging
mutation/rollback, which remains a gate before eventual separately approved production
backfill. No production target switch is provided.

References retrieved for preparation: [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/),
[R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
installed Wrangler4.103.0 account-scoped object helpers, `eventPhotos.ts` serving/
visibility, `mediaCleanup.ts`/`purgeDeleted.ts` deletion, and migration0089.

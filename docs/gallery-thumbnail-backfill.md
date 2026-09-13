# Gallery thumbnail backfill (#521)

Stacked on thumbnail PR #520 (`4b0e181`), itself dependent on pagination #518.
This document supersedes the earlier **no backfill** scope for separately authorized
backfill. The owner accepted staging and approved production pagination, centered
320×320 thumbnails **and mandatory existing-media backfill**. Production target
support is prepared below; exact-head independent review is still required before
any production migration, backfill write, merge or deployment. CLI acknowledgement
switches do not themselves grant operational approval.

**Current state:** staging backfill/recovery rehearsal completed on independently
approved script head `3981e130` (review `ba62c1fb`: READY, no findings). All23 rows
are verified after actual writes and full reconciliation; see evidence below.
Exact-head CI passed before expansion; both deploy steps were skipped. This does
not authorize future writes or production. The switches below are not approval
by themselves. Do not deploy or push a deployment branch for this tool.

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

**Persisted metadata, not download headers:** official R2 List Objects JSON provides
`http_metadata`/`custom_metadata`. Each object GET brackets its body download with
exact-key metadata reads (prefix/per_page25, no assumed result order), requiring
unchanged metadata/ETag/size/last-modified and matching download ETag/body length.
A truncated/ambiguous prefix fails closed. Download `Content-Disposition` can be a
synthetic attachment header and is never replayed as stored metadata. Genuine stored
Content-Disposition, Content-Type, Cache-Control, Content-Encoding, Content-Language
and cache expiry are retained and compared; expiry is losslessly rendered as an
HTTP-date for PUT. Hash/MIME/dimension validation and exact metadata checks remain.
Unknown HTTP fields, nonempty custom metadata, non-Standard storage or encrypted
objects fail closed: the current Wrangler-compatible PUT surface has no verified
round-trip contract for them. These fields are **not** silently stripped.

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

Targets are checked against pinned environment-specific values, repository
`wrangler.toml`, remote DB UUID/name and bucket name in that account. Missing
migration0089 fails closed; it is never applied automatically. Unknown/mixed targets
are rejected before credential access. D1 reads assert zero rows written. Existing
staging arguments and the default staging transport remain unchanged. Every mode
rejects a manifest from the other environment before credential access.

The 0700 workspace is flocked; manifest/checkpoints are private, atomically replaced
and fsynced. Inventory is a cursor-based observation, not a global DB snapshot.
Apply rechecks rows and source/target bytes, so a stale inventory is not authority
to mutate. A changed source/row is skipped; re-inventory later in a **new** workspace
only after resolving the old journal. Do not edit status fields or delete a journal
to bypass reconciliation. Dry-run failure entries require investigation/new inventory.

## Production preparation and release gate

Production uses the root Wrangler bindings, **not** `--env production` and never
the staging deployment branch. Its pinned account is the same account as staging,
but its D1 UUID/name and R2 bucket are distinct. Use a **new production-only** private
workspace; never copy, retarget or edit the completed staging manifest/backups.
Version2 inventory has no total25-row ceiling: only each invocation is bounded
(default5, maximum25). Repeat dry-run until `inventory_complete=true`, including
an empty final page when the row count is an exact multiple of the batch size.
The legacy v1 import remains staging-only and limited to its original25 entries;
production always starts a fresh version2 inventory.

```bash
# Preparation only: these commands do not authorize remote writes.
umask 077
export PRODUCTION_BACKFILL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/thumbnail-production.XXXXXX")"
production_operator() {
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/thumbnail_backfill.py \
    --environment production \
    --account b9cec3916d500760a7c7b9c31c720d80 \
    --database 977fc3ef-3806-48fe-9019-918f54989279 \
    --bucket eventer-images \
    --workspace "$PRODUCTION_BACKFILL_DIR" "$@"
}
production_operator --batch 5  # default dry-run; requires schema0089 already present
```

Production apply/reconcile/rollback each requires **`--approve-production-writes`**.
Staging acknowledgement cannot authorize production or vice versa; supplying both
is rejected, including in dry-run. No production fallback to staging is allowed.
The same journals, fsynced replacement backups, source/target rechecks, flag CAS,
pending-intent priority, metadata refusal and recovery apply in both environments.
Existing main photos, saved posters and video bodies remain immutable; local
encoding reads only saved photos/posters, never a video body or paid processor.

Required dependency/release order after review (not executed by this preparation):

1. Require independent review of the exact support diff and exact-head PR CI.
   Merge #518 to main, then retarget/review/merge #520 to main, then #522 to main,
   preserving/rechecking the reviewed dependency content. Do not merge staging:
   it has environment-only history. Record the final release SHA and old production
   SHA, and recheck no unrelated changes entered the release.
2. With authorized credentials, read production target identity, schema and
   `d1_migrations` using SELECT queries before planning DDL. If0089 is absent,
   stop the ordinary backfill preflight; **do not spoof a flag column or migrate
   from the backfill tool**. Confirm the complete pending set first. After the
   review gate and release authorization, apply only the reviewed pending
   migrations with `wrangler d1 migrations apply eventer --remote` from the final
   release checkout. Verify `has_thumbnail` exists/default0 and0089 is recorded.
   Workflow deploy steps do not apply migrations automatically.
3. Push only the reviewed final release SHA to `production` (non-force), watch CI
   by that exact SHA, require success and verify the actual deployed version plus
   health. The existing CI runs deploy only on production/staging branch pushes;
   a feature PR push does not deploy. Do not force-rewind a deployment branch to
   retrigger a missing workflow; investigate separately.
4. Complete the fresh production dry-run in bounded invocations and review all
   counts/skips/failures privately. Under the reviewed production-write approval,
   pilot batch1 cases (new photo, replacement if present, video poster if present),
   then bounded batches5 only after pilot/recovery evidence. No overlapping
   thumbnail writers/workspaces. Historical staging reapply below is pinned to
   its old script head; it intentionally refuses this changed tool and is **not**
   a production reapply command. Any production rollback/reapply pilot needs a
   separately reviewed invocation, not hand-edited statuses.
5. Mandatory backfill is part of release acceptance, not a deferred follow-up:
   require a full bounded reconciliation sweep and aggregate D1/output/source
   evidence, with all eligible rows accounted for and no unexplained failure,
   conflict or pending intent. Keep the production manifest/backups for recovery.
   Validate authenticated gallery paging, fresh320-square grid/cache refresh,
   original lightbox, video playback/poster and visibility; health alone is not
   acceptance. Report exceptions explicitly rather than counting them as success.

After the gate, using the **same** production workspace and reviewed tool head:

```bash
production_operator --mode apply --batch 1 --approve-production-writes
production_operator --mode reconcile --batch 1 --approve-production-writes
# After pilot acceptance:
production_operator --mode apply --batch 5 --approve-production-writes
production_operator --mode reconcile --batch 5 --approve-production-writes
# Recovery only when required/approved; repeat boundedly, preserve evidence:
production_operator --mode rollback --batch 1 --approve-production-writes
```

On unknown outcomes stop new work and reconcile first. Application rollback is
separate from thumbnail rollback; retain the additive0089 column and all backups.
No transactional D1/R2 or overlapping-writer guarantee is introduced.

### Old rehearsal manifest: required version2 migration

Version1 mistakenly captured transport headers. It is rejected before remote
preflight by this version; **never use it for apply/reconcile/rollback** or simply
edit its version/headers. An untouched, fully ready v1 dry-run (1..25 entries, no
backup files) can be imported read-only into a **new** private workspace:

```bash
# Save the old private workspace path before switching BACKFILL_DIR.
export OLD_BACKFILL_DIR="$BACKFILL_DIR"
export BACKFILL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/thumbnail-rehearsal-v2.XXXXXX")"
operator --import-v1 "$OLD_BACKFILL_DIR/manifest.json"
```

This rechecks current row identity/flags and refreshes persisted metadata only,
requiring each source/old-object ETag and size to equal the recorded evidence and
previously absent thumbnails to remain absent. It preserves original SHA256/local
encoding evidence without downloading media again; records the original manifest
hash; leaves v1 unchanged. No partial new manifest is saved on failure. Changed rows,
objects, previously attempted writes, or larger manifests require investigation and
fresh version2 dry-run inventory, not forced conversion. Metadata-only changes are
observed as the new dry-run baseline, not interpreted as their historical state.

## Reviewed pilot, resume, verification

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

### Reapply a rolled-back pilot without editing its manifest

The CLI intentionally does not turn `rolled_back` into new work. For this rehearsal
the supervisor approved the following narrow invocation of the existing reviewed
`apply()` function, **one previously rolled-back entry only**. No statuses are
manually changed. Reapproval is needed for later use; never use this for pending,
conflicting or unreviewed states. `BACKFILL_DIR` must be the same version2 workspace;
`ROLLED_BACK_INDEX` is its privately checked zero-based entry index. Run from the
repository root. Script changes relative to the reviewed head are rejected, while
documentation-only commits are allowed.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 - "$ROLLED_BACK_INDEX" --approve-staging-writes <<'PY'
import argparse, json, os, subprocess, sys
from pathlib import Path
subprocess.run(['git', 'diff', '--exit-code', '3981e130', '--',
                'scripts/thumbnail_backfill.py', 'scripts/thumbnail_backfill_writer.py'],
               check=True, stdout=subprocess.DEVNULL)
sys.path.insert(0, str(Path.cwd() / 'scripts'))
import thumbnail_backfill as b
import thumbnail_backfill_writer as w
os.umask(0o077)
if sys.flags.optimize:
    raise SystemExit('Run without Python optimization')
assert len(sys.argv) == 3 and sys.argv[2] == '--approve-staging-writes'
b.check_target(argparse.Namespace(**b.TARGET))
with b.workspace(Path(os.environ['BACKFILL_DIR'])) as directory:
    path = directory / 'manifest.json'
    assert not path.is_symlink()
    state = json.loads(path.read_text())
    assert state['version'] == 2 and state['target'] == b.TARGET and state['inventory_complete']
    assert not any(e['status'] in ('intent', 'rollback_intent') for e in state['entries'])
    index = int(sys.argv[1])
    assert 0 <= index < len(state['entries'])
    entry = state['entries'][index]
    assert entry['status'] == 'rolled_back'
    api = b.Cloudflare(allow_write=True)
    api.preflight()
    row = b.current(api, entry['row'])
    assert b.alive(row, entry['row']) and row['has_thumbnail'] == entry['row']['has_thumbnail']
    assert w.same(api.object(b.keys(row)[0]), entry['source'])
    assert w.same(api.object(b.keys(row)[1]), entry['old'])
    w.apply(api, state, path, entry)
    assert entry['status'] == 'verified'
    print(json.dumps({'kind': row['kind'], 'status': entry['status']}))
PY
```

This retains staging preflight, complete inventory, workspace lock, original flag,
source/old-object checks, backup integrity and a fresh durable intent. It is not a
general status-reset command. A pre-existing dangling flag repaired to0 on rollback
will deliberately fail the original-flag assertion; investigate rather than bypass.

## Actual staging rehearsal evidence

Executed on2026-09-13 with approved script head `3981e130`; production untouched.
Initial pilot was batch1: two video-poster new targets, one photo replacement and
one missing-photo new target. Actual new-object rollback restored absence/flag0;
replacement rollback restored exact old bytes/HTTP metadata/flag1. All four unique
pilot rows were reapplied with the guarded invocation above. Five rollback/reapply
cycles were observed (the initial video pilot was repeated once); no conflict,
failure, skip or pending intent remained. Rollback evidence retained privately.

After pilot/recovery and exact-head CI success, remaining19 rows were applied in
batches5,5,5,4 (concurrency1). A full subsequent reconciliation covered all23 rows
in bounded slices5,5,5,5,2,1. Final D1:12 photos and11 videos, all `has_thumbnail=1`.
Success classes:8 missing-photo targets,4 non-square photo replacements,11 video
poster targets. Every thumbnail readback matched generated hash/persisted MIME/
bytes and decoded320×320; all23 saved source hashes and metadata remained unchanged.
No video bodies were read/decoded, originals modified, migration or deployment run.

Four original-thumbnail backups (320,819 bytes) and the version2 journal remain in
the private workspace for rollback; no temporary media directories remain. Retain
these until rollback is no longer required. Final output totals319,278 bytes.

**Application acceptance limitation:** no existing authorized application session
was available to the operator. No sessions were created, credentials extracted from
browser profiles/D1, or authentication bypassed. Anonymous gallery and cache-busted
thumbnail requests both returned403 with private/no-store headers; this proves the
observed denial boundary, not authenticated serving or which edge/application gate
rejected them. Direct R2/D1 proof is complete; authenticated grid/lightbox/video,
visibility and browser-cache acceptance still require an authorized staging user.

## Evidence and cleanup

Read-only staging observation: 23 rows, 12 photos (8 flag0/4 flag1), 11 videos
(all flag0), zero hidden/deleted-user rows.19 thumbnails absent; four JPEG variants
non-square (two360×480, two480×360), no proven compliant squares. All23 sources
present and decoded successfully:12 main photos +11 posters, no video body read.
Generated23 verified local320×320 WebPs, individual3,002–35,530B; totals216,376B
photos +102,902B posters. These describe the initial read-only baseline; actual
backfill and rollback/reconciliation results are recorded above.

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
mutation/rollback. That staging rehearsal is now complete; authenticated UI
acceptance was an operator limitation; the owner has since accepted staging.
Production support is separately gated above. Focused offline target tests cover
both-environment endpoint routing, mixed bindings/acknowledgements/manifests,
missing0089 refusal and a60-row inventory resumed with batches5 and25.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts -p 'test_thumbnail_backfill*.py' -v
```

References retrieved for preparation: [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/),
[R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[R2 List Objects persisted metadata](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list/),
installed Wrangler4.103.0 `putHeaderKeys`/account-scoped object helpers, `eventPhotos.ts` serving/
visibility, `mediaCleanup.ts`/`purgeDeleted.ts` deletion, and migration0089.

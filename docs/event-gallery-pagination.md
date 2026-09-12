# Event gallery pagination (#517)

## Approved scope and current constraints

The approved first step is newest-first event user-posted photos/videos, 24 per
page. No thumbnail generation, backfill, upload-cap change, migration, production
operation, merge or deployment is part of this PR. Existing visual styling stays.

`EventPhotos` currently fetches and renders every visible item. The public GET
handler uses `canViewPhotos` before reading, and the repository SELECT excludes
admin-hidden media and authors pending deletion. Upload `countByEvent` deliberately
counts **all** stored rows toward the shared 200 photo/video cap. Those are different
populations and must remain different. Existing unpaged API consumers must work.

## API and data contract

- Keep GET `/api/events/:id/photos` without `page` returning `{ photos }` unchanged.
- Opt in with `?page=N`, a positive safe integer whose 24-item offset is safe;
  malformed values return 400 after the existing visibility gate.
- Return `{ photos, total, page, limit: 24 }`. `page` is the requested page; pages
  beyond the end return an empty list and the real visible total.
- Paged queries use `LIMIT 24 OFFSET ...`, ordered by `created_at DESC, id DESC`.
  An ID tie-breaker makes equal timestamps deterministic; legacy order remains
  newest-first with the same deterministic tie-breaker.
- Share the visible FROM/WHERE fragment between list and total; execute both in
  one D1 batch so the response is internally consistent. Count excludes hidden
  media and deleted authors; visible comment counts keep existing filters.
- No new route/auth boundary or change to media serving, moderation, upload
  counting, profile/timeline queries or R2. No migration needed (200 stored rows
  per event bounds the work; existing event index remains sufficient).

## UI and state

- Use a separate paged query hook keyed below the existing event/photos prefix,
  including page. Existing upload/delete/comment invalidations refresh all pages.
  Do not reuse another page/event's data as placeholder content.
- Show total visible count in the heading; grid/lightbox operates on the current
  page. Compact, wrapping previous/page-status/next controls use Japanese/English
  strings, native button disabled states, and a labelled navigation region.
- Loading and failure are not an empty gallery; provide an explicit retry action.
  Disable paging while fetching. Show controls only when multiple pages exist.
- After deletion/moderation reduces total, clamp to the last valid page (or 1 when
  empty) and refetch. Do not present an out-of-range response as a genuine empty
  gallery. Upload refresh stays on the current page and updates its total; new
  items appear first on page 1. Existing video queue sequencing is unchanged.
- Key the gallery's stateful body by event ID: switching events resets page,
  lightbox, selection and queue and never combines old media IDs with new URLs.
  Already-started photo uploads retain the old event mutation closure.
- Offset paging is not a snapshot across requests: concurrent inserts/deletes can
  shift boundaries. Existing mutation invalidation and query refetch reconcile;
  no cursor/session infrastructure is justified for this capped gallery.

## Validation and acceptance

Focused real-worker API tests: 0/24/25/200 boundaries, mixed kinds, tied timestamps,
no overlaps, filtered totals, legacy response and parameter/auth gates. Reuse
attendance, hidden-content, video/cap tests. UI interaction tests cover pagination,
last-item deletion, upload invalidation, event switching, loading/error recovery,
posters/lightbox and existing video queue. Run relevant typechecks/build and
browser interaction at mobile/desktop widths in Japanese/English; mutate an
implementation in a disposable copy and show the relevant regression test fails.
Full repository gates run on the feature PR CI. Stop before merge/deploy.

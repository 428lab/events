# Event gallery thumbnails (#519)

Approved: new photo uploads and video posters get a separate browser-encoded image
with long edge at most 320px, aspect preserved and no upscale. Event grid only uses
this variant; photo lightbox, video and its main poster remain unchanged. No
backfill, new service/binding or deployment. Stacked on pagination PR #518,
base `2a3b471633f3604081ed4c202a3cc508899cf4bf` (not staging).

## Contract

- Add optional `thumbnail` File to video multipart and accept photo multipart
  (`photo`, optional `thumbnail`) alongside the existing raw photo body.
- `has_thumbnail INTEGER NOT NULL DEFAULT 0` records successful storage, exposed
  as optional `hasThumbnail` on event media. Old rows/clients remain valid.
- Browser uses existing WebP/JPEG encoder, 320px, quality .8 then .5; max 128KiB.
  Encoding failure omits the variant and truthfully uses legacy main image/poster;
  never upload the original as a purported thumbnail. Poster decode failure still
  allows video without poster. The queue/cancel stages are unchanged.
- Server checks thumbnail bytes, WebP/JPEG signature and encoded dimensions
  (1..480) to retain upload compatibility with older 480px clients. The new
  generation target (320px) is separate from this acceptance ceiling. This is
  bounded header validation, not a full image decoder, like existing video validation. A submitted invalid thumbnail rejects before writes.
- R2: photo `event-photos/{event}/{id}-thumbnail`, video
  `event-videos/{event}/{id}-thumbnail`. MIME is actual encoded blob MIME in R2.
- Write all objects before inserting D1; rollback all possible keys on precommit
  failure (existing best-effort logged cleanup contract). No optional write after
  commit that could make a successful post appear rejected. A lost response or
  cancellation racing commit remains inherently ambiguous as before.
- `/photos/:photoId/thumbnail` shares existing visibility/moderation lookup and
  private cache/nosniff headers. Legacy media are not probed with failing requests.
- Central `photoObjectKeys` includes the variant unconditionally, so individual,
  event and account deletion, including hidden media, cannot omit it.
- Existing per-main-file limits, shared 200 cap, newest ordering and 24-item pages
  are unchanged. Video body allowance grows only by the thumbnail byte limit.

## Rollout / rollback

Migration `0089_gallery_thumbnails.sql` must precede the new Worker. It is additive;
old code ignores the column. Roll back code without dropping the column or R2
objects. No migration or backfill is applied remotely by this work.

## 320px follow-up

Only new photo/video-poster thumbnail generation changes from 480px to 320px
(FIRST320). Saved 480px objects keep serving unchanged; no regeneration or backfill.
Main images, videos/posters, byte limits, pagination and authorization are unchanged.
No additional migration is needed beyond the original feature's 0089. No deployment
is performed by this follow-up; independent review and exact-head CI remain gates.

Focused checks: 13 web tests, 16 thumbnail Worker tests and workspace typechecks pass.
Real Chromium encoding produces 320×213 landscape, 213×320 portrait, 320×160 from
400×200, unchanged 80×40 tiny input, and 320×180 from a real 960×540 video poster.
All five WebP outputs pass the server byte gate; main dimensions stay unchanged.
A disposable 480px encoder mutation fails all three dimension assertions.

## Original 480px validation before PR

- Workers/D1/R2 focused suite: 62 passing tests; expanded thumbnail suite then
  passed 16 tests (MIME/dimensions, multipart/raw compatibility, authorization,
  hidden/deleted authors, R2 partial-write and D1-insert failure cleanup).
- Web focused suite: 33 passing tests; video multipart wiring suite expanded to
  8 passing tests. Page integration distinguishes small grid / main lightbox.
- Workspace typechecks and production build pass (existing large-chunk warning).
- Real Chromium 151 and WebKit 26.5: photo and one-second H.264 video selected
  through the real UI; actual video conversion/poster extraction and image
  encoding. Landscape/portrait/no-upscale, JPEG fallback, decode-failure omission,
  24-item paging and grid/main request separation pass with intercepted local API.
- Example photo bytes: Chromium 656,918 main → 58,354 small; WebKit JPEG
  992,267 → 122,101. Poster bytes: Chromium 16,524 → 6,210; WebKit
  48,801 → 16,466. All four actual outputs pass the server header gate.
- WebKit Playwright does not expose multipart file bytes in intercepted requests;
  measured the real FormData Blobs before transport instead. Worker acceptance
  and lifecycle are independently tested against local D1/R2, not a staged server.
- No full iPhone Safari/device matrix, load test, backfill or remote migration.
  Independent review and exact-head CI remain gates before any deployment.

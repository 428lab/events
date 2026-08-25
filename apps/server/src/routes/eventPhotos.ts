import { Hono } from "hono";
import type { Context } from "hono";
import {
  EVENT_PHOTO_LIMIT,
  EVENT_PHOTO_MAX_BYTES,
  EVENT_VIDEO_MAX_BYTES,
  EVENT_VIDEO_MAX_DURATION_MS,
  PHOTO_COMMENT_LIMIT,
  createPhotoCommentInput,
} from "@eventer/shared";
import type { CreatePhotoCommentInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth, currentUser } from "../auth/session.js";
import { isConfirmedEventStaff, requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { getBucket } from "../runtime.js";
import { valid, zValidator } from "../lib/validator.js";
import { normalizeImageMime, safeServeMime } from "../lib/imageMime.js";
import {
  hasVideoMagicBytes,
  normalizeVideoMime,
  safeServeVideoMime,
} from "../lib/videoMime.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventPhotosRepo } from "../db/repositories/eventPhotos.js";
import { eventPhotoCommentsRepo } from "../db/repositories/eventPhotoComments.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";

const MEMBER_ROLES = ["participant", "staff", "judge", "observer"] as const;
/** R2 のキー。管理画面 (#278) と退会時の purge (#244) も同じ実体を
 * 扱うので、キーの組み立てはここに集約する */
export const photoR2Key = (eventId: string, photoId: string) =>
  `event-photos/${eventId}/${photoId}`;
export const videoR2Key = (eventId: string, videoId: string) =>
  `event-videos/${eventId}/${videoId}`;
/** ポスター（サムネイル画像）は本体の兄弟キーに置く (#408) */
export const videoPosterR2Key = (eventId: string, videoId: string) =>
  `${videoR2Key(eventId, videoId)}-poster`;

/** 写真を閲覧できるか。photos_public 公開イベントは誰でも、
 * それ以外はメンバー/管理者のみ */
async function canViewPhotos(eventId: string, c: Context): Promise<boolean> {
  const event = await eventsRepo.findById(eventId);
  if (!event) return false;
  if (event.photosPublic && event.status === "published") return true;
  const user = await currentUser(c);
  if (!user) return false;
  if (isAppAdmin(user)) return true;
  const member = await eventMembersRepo.find(eventId, user.id);
  if (!member) return false;
  // 参加が確定していない人（落選・申込中・キャンセル待ち）は見られない (#289)。
  // 写真には参加者が写るので、参加していない人に見せる理由が無い。
  // 参加を取り消した人は find がメンバー扱いしないので、ここに来る前に落ちる
  if (member.status !== "confirmed") return false;
  // 出席チェックモードでは、参加者ロールは出席チェック済みのみ閲覧可
  // （実際に来た人だけに見せる。参加者数の表示とは別の基準）
  if (event.attendanceCheck && member.role === "participant" && !member.attended) {
    return false;
  }
  return true;
}

/* ===== 公開ハンドラ（未ログイン可。worker.ts で eventRoutes より先に登録） ===== */

/** 写真一覧 */
export async function getEventPhotos(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  if (!(await canViewPhotos(eventId, c))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({ photos: await eventPhotosRepo.listByEvent(eventId) });
}

/** 写真本体 */
export async function getEventPhotoImage(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  if (!(await canViewPhotos(eventId, c))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const photo = await eventPhotosRepo.findById(c.req.param("photoId")!);
  if (!photo || photo.eventId !== eventId) {
    return c.json({ error: "not_found" }, 404);
  }
  const obj = await getBucket().get(photoR2Key(photo.eventId, photo.id));
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      "Content-Type": safeServeMime(obj.httpMetadata?.contentType),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

/** Range ヘッダ（単一範囲のみ）を解釈する。
 * - 文法不正・複数範囲 → "invalid"（RFC 9110 に従い無視して 200 全量を返す）
 * - 満たせない範囲（開始がサイズ以上等） → "unsatisfiable"（416）
 * R2 にも Headers をそのまま渡せるが、満たせない範囲で throw する仕様に
 * エラー処理を委ねると分岐が読めなくなるため、判定はここで済ませる */
function parseByteRange(
  header: string,
  size: number,
): { offset: number; length: number } | "invalid" | "unsatisfiable" {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "invalid";
  const [, s, e] = m;
  if (s === "") {
    // suffix 形式 bytes=-N（末尾 N バイト）
    if (e === "") return "invalid";
    const suffix = Number(e);
    if (suffix === 0) return "unsatisfiable";
    const offset = Math.max(0, size - suffix);
    return { offset, length: size - offset };
  }
  const offset = Number(s);
  if (offset >= size) return "unsatisfiable";
  const endPos = e === "" ? size - 1 : Math.min(Number(e), size - 1);
  if (endPos < offset) return "unsatisfiable";
  return { offset, length: endPos - offset + 1 };
}

/** 動画本体 (#408)。iOS Safari の <video> は最初から Range を投げるため、
 * 206 Partial Content 対応は必須（コードベース初の Range 対応）。
 * 206/304/416 のステータスと Content-Range の組み立ては Worker 側の責務。
 * Range リクエストは先に head でサイズを取り（+1 サブリクエスト。R2 の
 * 読み取りは安価）、範囲の妥当性を自前で判定してから get する */
export async function getEventPhotoVideo(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  if (!(await canViewPhotos(eventId, c))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const photo = await eventPhotosRepo.findById(c.req.param("photoId")!);
  if (!photo || photo.eventId !== eventId || photo.kind !== "video") {
    return c.json({ error: "not_found" }, 404);
  }
  const key = videoR2Key(eventId, photo.id);
  const bucket = getBucket();
  const reqHeaders = c.req.raw.headers;
  // 条件付き（If-None-Match 等）はヘッダがあるときだけ R2 に渡す
  const conditional =
    reqHeaders.has("if-none-match") ||
    reqHeaders.has("if-match") ||
    reqHeaders.has("if-modified-since") ||
    reqHeaders.has("if-unmodified-since");

  let range: { offset: number; length: number } | null = null;
  const rangeHeader = c.req.header("range");
  if (rangeHeader) {
    const head = await bucket.head(key);
    if (!head) return c.json({ error: "not_found" }, 404);
    const parsed = parseByteRange(rangeHeader, head.size);
    if (parsed === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${head.size}`,
        },
      });
    }
    if (parsed !== "invalid") range = parsed;
  }

  const obj =
    range || conditional
      ? await bucket.get(key, {
          ...(range ? { range } : {}),
          ...(conditional ? { onlyIf: reqHeaders } : {}),
        })
      : await bucket.get(key);
  if (!obj) return c.json({ error: "not_found" }, 404);

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    ETag: obj.httpEtag,
    "Cache-Control": "private, max-age=3600",
  });
  // onlyIf（If-None-Match 等）で前提条件が満たされないと body なしで返る
  if (!("body" in obj) || !obj.body) {
    return new Response(null, { status: 304, headers });
  }
  headers.set("Content-Type", safeServeVideoMime(obj.httpMetadata?.contentType));
  headers.set("X-Content-Type-Options", "nosniff");
  if (range) {
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${obj.size}`,
    );
    headers.set("Content-Length", String(range.length));
    return new Response(obj.body as unknown as ReadableStream, {
      status: 206,
      headers,
    });
  }
  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body as unknown as ReadableStream, { headers });
}

/** 動画のポスター画像 (#408)。写真の image 配信と同型。
 * ポスターなしで投稿された動画（切り出せない環境）は 404 になり、
 * クライアントがプレースホルダを出す */
export async function getEventPhotoPoster(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  if (!(await canViewPhotos(eventId, c))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const photo = await eventPhotosRepo.findById(c.req.param("photoId")!);
  if (!photo || photo.eventId !== eventId || photo.kind !== "video") {
    return c.json({ error: "not_found" }, 404);
  }
  const obj = await getBucket().get(videoPosterR2Key(eventId, photo.id));
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      "Content-Type": safeServeMime(obj.httpMetadata?.contentType),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

/** 写真コメント一覧（閲覧できる人は誰でも） */
export async function getPhotoComments(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  if (!(await canViewPhotos(eventId, c))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const photo = await eventPhotosRepo.findById(c.req.param("photoId")!);
  if (!photo || photo.eventId !== eventId) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({
    comments: await eventPhotoCommentsRepo.listByPhoto(photo.id),
  });
}

/* ===== 書き込み（要認証。アップロード・コメント・削除はメンバーのみ） ===== */

export const eventPhotoRoutes = new Hono<AppEnv>();
eventPhotoRoutes.use("*", requireAuth);

/** コメント投稿（メンバー。他人の写真にも複数可） */
eventPhotoRoutes.post(
  "/:id/photos/:photoId/comments",
  requireEventRole([...MEMBER_ROLES]),
  zValidator("json", createPhotoCommentInput),
  async (c) => {
    const eventId = c.req.param("id");
    const photo = await eventPhotosRepo.findById(c.req.param("photoId"));
    if (!photo || photo.eventId !== eventId) {
      return c.json({ error: "not_found" }, 404);
    }
    if ((await eventPhotoCommentsRepo.countByPhoto(photo.id)) >= PHOTO_COMMENT_LIMIT) {
      return c.json({ error: "comment_limit", limit: PHOTO_COMMENT_LIMIT }, 409);
    }
    const comment = await eventPhotoCommentsRepo.create(
      photo.id,
      c.get("user").id,
      valid<CreatePhotoCommentInput>(c, "json").body,
    );
    return c.json({ comment }, 201);
  },
);

/** コメント削除（投稿者本人 or **そのイベントの参加確定 staff メンバー**）。
 * 他人のコメントを消すのはイベント内コンテンツのモデレーションなので、
 * サイト管理者・コミュニティ管理者というだけでは通さない (#275) */
eventPhotoRoutes.delete(
  "/:id/photos/:photoId/comments/:commentId",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const eventId = c.req.param("id");
    const user = c.get("user");
    const comment = await eventPhotoCommentsRepo.meta(c.req.param("commentId"));
    if (!comment || comment.photoId !== c.req.param("photoId")) {
      return c.json({ error: "not_found" }, 404);
    }
    if (
      comment.userId !== user.id &&
      !(await isConfirmedEventStaff(eventId, user.id))
    ) {
      return c.json({ error: "forbidden" }, 403);
    }
    // 運営が対処したコメント (#278) は消せない。理由が分かるように 409（写真と同じ）
    if (comment.adminHidden) return c.json({ error: "content_hidden" }, 409);
    await eventPhotoCommentsRepo.delete(comment.id);
    return c.json({ ok: true });
  },
);

/** アップロード（生バイナリ） */
eventPhotoRoutes.post(
  "/:id/photos",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const eventId = c.req.param("id");
    const mime = normalizeImageMime(c.req.header("content-type"));
    if (!mime) return c.json({ error: "invalid_content_type" }, 400);
    if (Number(c.req.header("content-length") ?? "0") > EVENT_PHOTO_MAX_BYTES) {
      return c.json({ error: "too_large", maxBytes: EVENT_PHOTO_MAX_BYTES }, 413);
    }
    if ((await eventPhotosRepo.countByEvent(eventId)) >= EVENT_PHOTO_LIMIT) {
      return c.json({ error: "photo_limit", limit: EVENT_PHOTO_LIMIT }, 409);
    }
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) return c.json({ error: "empty_body" }, 400);
    if (body.byteLength > EVENT_PHOTO_MAX_BYTES) {
      return c.json({ error: "too_large", maxBytes: EVENT_PHOTO_MAX_BYTES }, 413);
    }
    const photoId = await eventPhotosRepo.create(eventId, c.get("user").id);
    await getBucket().put(photoR2Key(eventId, photoId), body, {
      httpMetadata: { contentType: mime },
    });
    return c.json({ photo: await eventPhotosRepo.findById(photoId) }, 201);
  },
);

/** 動画アップロード (#408)。multipart で本体＋ポスターを1リクエストで受け、
 * 「本体はあるがポスターがない」中間状態を API 上に作らない。
 * ボディ上限は worker.ts のグローバル bodyLimit がこのパスだけ広げている
 * （門はそこ1枚。ここで bodyLimit を重ねない） */
eventPhotoRoutes.post(
  "/:id/videos",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const eventId = c.req.param("id");
    const body = await c.req.parseBody();
    const video = body["video"];
    const poster = body["poster"];
    if (!(video instanceof File)) return c.json({ error: "video_required" }, 400);

    // 検証は写真の流儀で順に弾く: MIME 許可リスト → サイズ → 長さ → ポスター
    // → 本数上限 → マジックバイト（読み込みが要るものを後ろに）
    const mime = normalizeVideoMime(video.type);
    if (!mime) return c.json({ error: "invalid_content_type" }, 400);
    if (video.size === 0) return c.json({ error: "empty_body" }, 400);
    if (video.size > EVENT_VIDEO_MAX_BYTES) {
      return c.json({ error: "too_large", maxBytes: EVENT_VIDEO_MAX_BYTES }, 413);
    }
    // 長さはクライアント申告値（表示用）。サーバーで実測はしない（§videoMime.ts の
    // 割り切りと同じ理由）が、明らかな超過申告はここで弾く。実効的な制限は
    // バイト数上限が担保する
    const durationMs = Number(
      typeof body["durationMs"] === "string" ? body["durationMs"] : NaN,
    );
    if (
      !Number.isInteger(durationMs) ||
      durationMs <= 0 ||
      durationMs > EVENT_VIDEO_MAX_DURATION_MS
    ) {
      return c.json(
        { error: "invalid_duration", maxMs: EVENT_VIDEO_MAX_DURATION_MS },
        400,
      );
    }
    let posterMime: string | null = null;
    if (poster !== undefined) {
      if (!(poster instanceof File)) return c.json({ error: "invalid_poster" }, 400);
      posterMime = normalizeImageMime(poster.type);
      if (!posterMime) return c.json({ error: "invalid_poster_type" }, 400);
      if (poster.size === 0) return c.json({ error: "invalid_poster" }, 400);
      if (poster.size > EVENT_PHOTO_MAX_BYTES) {
        return c.json({ error: "too_large", maxBytes: EVENT_PHOTO_MAX_BYTES }, 413);
      }
    }
    // 本数は写真と共有の枠（動画専用の追加上限は設けない）
    if ((await eventPhotosRepo.countByEvent(eventId)) >= EVENT_PHOTO_LIMIT) {
      return c.json({ error: "photo_limit", limit: EVENT_PHOTO_LIMIT }, 409);
    }
    const bytes = await video.arrayBuffer();
    if (!hasVideoMagicBytes(new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength)), mime)) {
      return c.json({ error: "invalid_video" }, 400);
    }

    // 保存順序は R2 put（video → poster）→ D1 insert。写真（D1 → R2）と逆だが、
    // 大きいオブジェクトほど put 失敗の確率が上がるため
    // 「行はあるのに実体がない」壊れ方を避ける
    const videoId = crypto.randomUUID();
    const bucket = getBucket();
    await bucket.put(videoR2Key(eventId, videoId), bytes, {
      httpMetadata: { contentType: mime },
    });
    if (poster instanceof File && posterMime) {
      await bucket.put(videoPosterR2Key(eventId, videoId), await poster.arrayBuffer(), {
        httpMetadata: { contentType: posterMime },
      });
    }
    try {
      await eventPhotosRepo.createVideo(videoId, eventId, c.get("user").id, {
        durationMs,
        bytes: bytes.byteLength,
        mime,
      });
    } catch (e) {
      // D1 insert に失敗したら R2 を掃除する（best-effort。残骸はログで追える）
      try {
        await bucket.delete([
          videoR2Key(eventId, videoId),
          videoPosterR2Key(eventId, videoId),
        ]);
      } catch (cleanupError) {
        console.error("[event-video] R2 cleanup failed", videoId, cleanupError);
      }
      throw e;
    }
    return c.json({ photo: await eventPhotosRepo.findById(videoId) }, 201);
  },
);

/** 削除（投稿者本人 or **そのイベントの参加確定 staff メンバー**）。
 * 他人の写真を消すのはイベント内コンテンツのモデレーションなので、
 * サイト管理者・コミュニティ管理者というだけでは通さない (#275) */
eventPhotoRoutes.delete(
  "/:id/photos/:photoId",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const eventId = c.req.param("id");
    const user = c.get("user");
    const photo = await eventPhotosRepo.meta(c.req.param("photoId"));
    if (!photo || photo.eventId !== eventId) {
      return c.json({ error: "not_found" }, 404);
    }
    if (
      photo.userId !== user.id &&
      !(await isConfirmedEventStaff(eventId, user.id))
    ) {
      return c.json({ error: "forbidden" }, 403);
    }
    // 運営が対処した写真 (#278) は本人でもスタッフでも消せない。消せてしまうと
    // 対処の証跡ごと消える。**理由が分かるように 409 を返す**（Q&A と揃える。
    // 非表示を落とす findById で判定すると 404 になり、投稿者には
    // 「なぜか消せない」としか見えない）
    if (photo.adminHidden) return c.json({ error: "content_hidden" }, 409);
    // 動画は本体＋ポスターの2オブジェクト (#408)。ポスターなし投稿でも
    // 存在しないキーの削除は無害
    await getBucket().delete(
      photo.kind === "video"
        ? [videoR2Key(eventId, photo.id), videoPosterR2Key(eventId, photo.id)]
        : [photoR2Key(eventId, photo.id)],
    );
    await eventPhotosRepo.delete(photo.id);
    return c.json({ ok: true });
  },
);

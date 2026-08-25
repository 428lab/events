/**
 * アップロード動画の MIME 制御 (#408)。imageMime.ts と同じ許可リスト方式。
 *
 * ■ 実体検証の割り切り
 * Workers で動画コンテナを完全にパースするのは CPU 時間的に重く、やらない。
 * サーバー側の検証は「宣言 MIME の許可リスト＋先頭マジックバイト」まで。
 * 偽装ファイルが通っても、配信側が Content-Type を許可リストに固定し
 * `X-Content-Type-Options: nosniff` を必ず付けるので、ブラウザに
 * HTML/スクリプトとして解釈させる余地はない（<video> が再生に失敗するだけ）。
 */
const ALLOWED_VIDEO_MIMES = new Set(["video/webm", "video/mp4"]);

/** Content-Type から許可された動画 MIME を返す。不許可なら null。
 * `video/webm;codecs=vp9` のようなパラメータは正規化して落とす */
export function normalizeVideoMime(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  return ALLOWED_VIDEO_MIMES.has(mime) ? mime : null;
}

/** 保存済みメタの MIME を配信用に安全化。許可外は octet-stream に */
export function safeServeVideoMime(mime: string | undefined | null): string {
  const m = (mime ?? "").split(";")[0]!.trim().toLowerCase();
  return ALLOWED_VIDEO_MIMES.has(m) ? m : "application/octet-stream";
}

/** 先頭バイトが宣言 MIME のコンテナに見えるか。
 * WebM(Matroska) は先頭が EBML ヘッダ 1A 45 DF A3、
 * MP4(ISOBMFF) は offset 4 に 'ftyp'。画像より偽装リスクが高い
 * （<video> として直配信する）ので、宣言 MIME だけは信じない */
export function hasVideoMagicBytes(head: Uint8Array, mime: string): boolean {
  if (mime === "video/webm") {
    return (
      head.length >= 4 &&
      head[0] === 0x1a &&
      head[1] === 0x45 &&
      head[2] === 0xdf &&
      head[3] === 0xa3
    );
  }
  // video/mp4
  return (
    head.length >= 8 &&
    head[4] === 0x66 && // f
    head[5] === 0x74 && // t
    head[6] === 0x79 && // y
    head[7] === 0x70 // p
  );
}

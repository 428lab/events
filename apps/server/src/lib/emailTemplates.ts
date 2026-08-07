/** 通知メールのHTMLテンプレート (#126, #134)。
 * env に依存しない純粋関数のみ（baseUrl は引数で受け取る）。テストから直接呼べる */

export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** アプリ内パスに ?ref=email を付けた絶対URL（既にクエリがあれば & で連結） */
export function refEmailUrl(baseUrl: string, path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${baseUrl}${path}${sep}ref=email`;
}

/** メールヘッダー（ロゴ＋ワードマーク）。Gmail 等は SVG を表示しないため PNG を使う */
export function emailHeaderHtml(baseUrl: string): string {
  return `<p style="margin:0 0 24px;">
      <img src="${escapeHtml(baseUrl)}/logo-email.png" width="28" height="28" alt="events lab" style="vertical-align:middle;">
      <span style="margin-left:8px;color:#64748B;font-size:13px;font-weight:600;letter-spacing:.05em;vertical-align:middle;">events lab</span>
    </p>`;
}

/** Markdown をざっくりプレーンテキスト化する（説明冒頭の抜粋用）。
 * リンクはテキストだけ残し、画像・記号マーカーは除去、空白は1つに畳む */
export function stripMarkdown(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, " ") // コードブロック
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 画像
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // リンク → テキストのみ
    .replace(/^#{1,6}\s+/gm, "") // 見出しマーカー
    .replace(/^\s{0,3}>\s?/gm, "") // 引用マーカー
    .replace(/^\s*[-*+]\s+/gm, "") // 箇条書きマーカー
    .replace(/[*_~`]/g, "") // 強調・コード記号
    .replace(/\s+/g, " ")
    .trim();
}

/** 説明の冒頭抜粋（プレーンテキスト・最大 max 文字。超えたら … を付ける） */
export function descriptionExcerpt(description: string, max = 200): string {
  const plain = stripMarkdown(description);
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

const JST = "Asia/Tokyo";

/** JST の日付表記（例: 2026/8/22(土)） */
function jstDate(ms: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: JST,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(ms);
}

/** JST の時刻表記（例: 13:00） */
function jstTime(ms: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: JST,
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

/** 開催日時の表記（JST）。
 * 日程調整中/開始未定 → 文言のみ。終了未定は開始のみ。同日は終了を時刻だけにする */
export function formatEventDateTime(
  startsAt: number,
  endsAt: number,
  scheduling: boolean,
): string {
  if (scheduling) return "日程調整中";
  if (!startsAt) return "日時未定";
  const start = `${jstDate(startsAt)} ${jstTime(startsAt)}`;
  if (!endsAt || endsAt <= startsAt) return `${start}〜`;
  const sameDay = jstDate(startsAt) === jstDate(endsAt);
  return sameDay
    ? `${start}〜${jstTime(endsAt)}`
    : `${start}〜${jstDate(endsAt)} ${jstTime(endsAt)}`;
}

/** 会場種別ラベル（web の venueLabel と同じ対応） */
export const VENUE_LABEL: Record<string, string> = {
  offline: "オフライン",
  online: "オンライン",
  hybrid: "ハイブリッド",
};

/** 会場表記（オフライン/ハイブリッドは場所名も併記。URLは載せずリンク先で確認） */
export function venueText(
  venueType: string,
  venueOffline: string | null,
): string {
  const label = VENUE_LABEL[venueType] ?? venueType;
  if (venueType !== "online" && venueOffline) {
    return `${label}（${venueOffline}）`;
  }
  return label;
}

/** eventCardHtml が必要とするイベント項目（Event のサブセット） */
export interface EventCardEvent {
  id: string;
  title: string;
  description: string;
  startsAt: number;
  endsAt: number;
  scheduling: boolean;
  venueType: string;
  venueOffline: string | null;
  imageUpdatedAt: number | null;
}

/** ラベル付きの1行（開催日時／会場など） */
function cardRow(label: string, value: string): string {
  return `<p style="margin:0 0 6px;color:#334155;font-size:14px;line-height:1.7;">
        <span style="color:#64748B;font-size:12px;">${escapeHtml(label)}</span><br>${escapeHtml(value)}
      </p>`;
}

/** イベントカード（画像・開催日時・会場・コミュニティ・説明冒頭）(#134) */
export function eventCardHtml(opts: {
  baseUrl: string;
  event: EventCardEvent;
  communityName: string | null;
}): string {
  const { baseUrl, event, communityName } = opts;
  const image = event.imageUpdatedAt
    ? `<img src="${escapeHtml(`${baseUrl}/api/events/${event.id}/image?v=${event.imageUpdatedAt}`)}" alt="${escapeHtml(event.title)}"
           style="width:100%;max-width:560px;height:auto;border-radius:8px 8px 0 0;display:block;">`
    : "";
  const excerpt = descriptionExcerpt(event.description);
  const excerptHtml = excerpt
    ? `<p style="margin:10px 0 0;color:#64748B;font-size:13px;line-height:1.7;">${escapeHtml(excerpt)}</p>`
    : "";
  return `<div style="margin:16px 0;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
      ${image}
      <div style="padding:16px;">
        ${cardRow("開催日時", formatEventDateTime(event.startsAt, event.endsAt, event.scheduling))}
        ${cardRow("会場", venueText(event.venueType, event.venueOffline))}
        ${communityName ? cardRow("コミュニティ", communityName) : ""}
        ${excerptHtml}
      </div>
    </div>`;
}

/** timetableHtml が必要とするタイムテーブル項目（ScheduleItem のサブセット） */
export interface TimetableItem {
  title: string;
  speakerName: string;
  speaker: { username: string; globalName: string | null } | null;
}

/** タイムテーブル（時刻｜内容＋担当）。times は computeScheduleTimes の結果 (#134) */
export function timetableHtml(opts: {
  items: TimetableItem[];
  times: Array<number | null>;
}): string {
  if (opts.items.length === 0) return "";
  const rows = opts.items
    .map((it, i) => {
      const time = opts.times[i];
      const speakerName = it.speaker
        ? (it.speaker.globalName ?? it.speaker.username)
        : it.speakerName;
      const speaker = speakerName
        ? ` <span style="color:#94A3B8;">（${escapeHtml(speakerName)}）</span>`
        : "";
      return `<tr>
          <td style="padding:6px 12px 6px 0;color:#64748B;font-size:13px;white-space:nowrap;vertical-align:top;">${time === null ? "--:--" : jstTime(time)}</td>
          <td style="padding:6px 0;color:#334155;font-size:14px;line-height:1.6;">${escapeHtml(it.title)}${speaker}</td>
        </tr>`;
    })
    .join("\n");
  return `<div style="margin:16px 0;">
      <p style="margin:0 0 4px;color:#64748B;font-size:12px;font-weight:600;">タイムテーブル</p>
      <table style="border-collapse:collapse;width:100%;" role="presentation">${rows}</table>
    </div>`;
}

/** フォロー起点通知のタイトルHTML。「◯◯ さんが…」の ◯◯ をプロフィールへリンクする。
 * タイトルが actorName で始まらない場合は null（プレーン表示にフォールバック） */
export function actorTitleHtml(opts: {
  baseUrl: string;
  title: string;
  actorName: string;
  actorPath: string;
}): string | null {
  const { baseUrl, title, actorName, actorPath } = opts;
  if (!actorName || !title.startsWith(actorName)) return null;
  const url = refEmailUrl(baseUrl, actorPath);
  return `<a href="${escapeHtml(url)}" style="color:#0F172A;">${escapeHtml(actorName)}</a>${escapeHtml(title.slice(actorName.length))}`;
}

/** 通知メールの最小HTML（インラインスタイル・ライト配色）。
 * titleHtml/extraHtml はエスケープ済みHTMLを渡すこと（それ以外の文字列は内部でエスケープ） */
export function notificationEmailHtml(opts: {
  baseUrl: string;
  title: string;
  /** タイトルのHTML上書き（actor リンク付き等）。省略時は title をエスケープして表示 */
  titleHtml?: string | null;
  body: string;
  /** 本文とボタンの間に挿す追加HTML（イベントカード・タイムテーブル） */
  extraHtml?: string;
  linkUrl: string | null;
  unsubscribeUrl: string;
}): string {
  const button = opts.linkUrl
    ? `<p style="margin:24px 0;">
        <a href="${escapeHtml(opts.linkUrl)}"
           style="display:inline-block;background:#1E293B;color:#FFFFFF;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">
          詳細を見る
        </a>
      </p>`
    : "";
  // white-space:pre-wrap で本文の改行をそのまま出す。一斉連絡 (#172) のように
  // 複数行の本文を送れる通知があり、指定が無いと全部1段落に潰れる
  const body = opts.body
    ? `<p style="margin:0 0 8px;color:#334155;font-size:15px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(opts.body)}</p>`
    : "";
  return `<div style="background:#F8FAFC;padding:32px 16px;font-family:'Hiragino Sans','Noto Sans JP',system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;padding:32px;">
    ${emailHeaderHtml(opts.baseUrl)}
    <h1 style="margin:0 0 12px;color:#0F172A;font-size:18px;line-height:1.5;">${opts.titleHtml ?? escapeHtml(opts.title)}</h1>
    ${body}
    ${opts.extraHtml ?? ""}
    ${button}
  </div>
  <p style="max-width:560px;margin:16px auto 0;color:#94A3B8;font-size:12px;line-height:1.6;">
    このメールは events lab のメール通知設定が ON のため送信されています。<br>
    <a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#64748B;">メール通知を停止する</a>
  </p>
</div>`;
}

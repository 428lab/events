/** KPI の「推移」まわりの共通定義 (#266)。
 *
 * ここには2つのことをまとめている。
 *   1. 指標ごとの「増えたら良いのか」の定義（KPI_METRICS）
 *   2. 前期間比の計算（kpiTrend）と、時系列の粒度・週まとめ（kpiGranularity 等）
 *
 * 方向の定義を画面側に散らすと、キャンセル率が増えたのに緑になる、のような
 * 誤読を生む修正漏れが必ず起きる。**方向はこのファイルだけが持ち**、
 * 全体KPI・コミュニティKPI の画面はここを参照する。 */

/** 増減の意味。
 * - up:      増えたら良い（参加体験数・開催数・リピート率・アクティベーション率など）
 * - down:    減ったら良い（キャンセル率・無断欠席率・不発率・休眠会員率・退会数など）
 * - neutral: 文脈で意味が変わる（取消を含む登録数・下書き数など）。色を付けない */
export type KpiDirection = "up" | "down" | "neutral";

/** 値の種類。前期間との差の見せ方が変わる。
 * - count: 件数・人数 → 相対変化率（+20% など）
 * - rate:  割合(0〜1)  → ポイント差（+3.0pt など。率の率は誤読するので出さない）
 * - avg:   平均値      → 相対変化率 */
export type KpiMetricKind = "count" | "rate" | "avg";

export interface KpiMetricMeta {
  direction: KpiDirection;
  kind: KpiMetricKind;
}

/** 前期間比（変化率）を出すのに必要な最小の大きさ。
 * COMMUNITY_KPI_MIN_SAMPLE と同じ考え方で、1→2 を「+100%」と出さないためのゲート。
 * 件数・平均の指標に対して「今期間と前期間の大きい方」に掛ける。
 * 率の指標は、率そのものが分母0・母数不足のとき null で返ってくる（＝サーバー側で
 * すでにゲート済み）ので、ここでは掛けない。 */
export const KPI_TREND_MIN_SAMPLE = 5;

/** 指標ごとの方向と種類。**キーは全体KPIとコミュニティKPIで共通**にしている
 * （同じ「キャンセル率」が画面によって色が違う、ということが起きないように）。
 *
 * 現在の値のスナップショット（在籍ユーザー数・退会申請中・ログイン方法の内訳）は
 * 期間で切っていないので前期間が存在せず、ここには入れない。 */
export const KPI_METRICS = {
  // --- 北極星 ---
  /** 参加体験の数（開催済みイベントの参加者の合計） */
  participations: { direction: "up", kind: "count" },
  /** 開催イベント数 */
  heldEvents: { direction: "up", kind: "count" },
  /** 1イベントあたり平均参加者 */
  avgParticipantsPerEvent: { direction: "up", kind: "avg" },

  // --- 参加者（需要側）---
  /** 参加登録数。**取消を含む全ステータス**なので、増えたことが良いとは限らない */
  registrations: { direction: "neutral", kind: "count" },
  /** うち確定している登録 */
  confirmedRegistrations: { direction: "up", kind: "count" },
  /** イベント詳細の閲覧UU */
  uniqueViewers: { direction: "up", kind: "count" },
  /** イベント詳細の総表示回数 */
  totalViews: { direction: "up", kind: "count" },
  /** 閲覧→登録の転換率 */
  viewToJoinRate: { direction: "up", kind: "rate" },
  /** 出席率 */
  attendanceRate: { direction: "up", kind: "rate" },
  /** 無断欠席率（減ったら良い） */
  noShowRate: { direction: "down", kind: "rate" },
  /** キャンセル率（減ったら良い） */
  cancelRate: { direction: "down", kind: "rate" },
  /** 直前24時間のキャンセル率（減ったら良い） */
  lateCancelRate: { direction: "down", kind: "rate" },
  /** リピート参加率 */
  repeatRate: { direction: "up", kind: "rate" },
  /** 期間内に参加した実人数 */
  uniqueParticipants: { direction: "up", kind: "count" },

  // --- 主催者（供給側）---
  /** イベント作成数（下書きを含む全ステータス） */
  createdEvents: { direction: "up", kind: "count" },
  /** 作成されたまま下書きのイベント。増減どちらが良いとも言えない */
  draftEvents: { direction: "neutral", kind: "count" },
  /** 公開されたイベント */
  publishedEvents: { direction: "up", kind: "count" },
  /** 日程調整中のイベント。多い＝確定できていないとも、活発とも読める */
  schedulingEvents: { direction: "neutral", kind: "count" },
  /** 日程確定率 */
  schedulingConfirmRate: { direction: "up", kind: "rate" },
  /** 不発率（減ったら良い） */
  dudRate: { direction: "down", kind: "rate" },
  /** 主催者の実人数 */
  hosts: { direction: "up", kind: "count" },
  /** 再開催率 */
  repeatHostRate: { direction: "up", kind: "rate" },
  /** 主催者あたり開催数 */
  avgEventsPerHost: { direction: "up", kind: "avg" },
  /** いちばん多く開催した1人のシェア。高いほど特定の人に依存している（減ったら良い） */
  topHostShare: { direction: "down", kind: "rate" },

  // --- 定着 ---
  /** 新規登録者数 */
  signups: { direction: "up", kind: "count" },
  /** 登録→初回参加の率 */
  activationParticipantRate: { direction: "up", kind: "rate" },
  /** 登録→初回主催の率 */
  activationHostRate: { direction: "up", kind: "rate" },

  // --- 健全性 ---
  /** 退会申請数（減ったら良い） */
  deleteRequested: { direction: "down", kind: "count" },
  /** 完全削除数（減ったら良い） */
  deleteCompleted: { direction: "down", kind: "count" },
  /** 猶予期間中の復帰数（増えたら良い） */
  restored: { direction: "up", kind: "count" },
  /** チャット利用率 */
  chatUsedRate: { direction: "up", kind: "rate" },
  /** アンケート利用率 */
  surveyUsedRate: { direction: "up", kind: "rate" },
  /** チェックイン利用率 */
  checkinUsedRate: { direction: "up", kind: "rate" },

  // --- マッチング ---
  /** 会場オファー数 */
  venueOffers: { direction: "up", kind: "count" },
  /** オファー成立率 */
  venueOfferAcceptRate: { direction: "up", kind: "rate" },
  /** 会場募集の充足率 */
  venueWantedFillRate: { direction: "up", kind: "rate" },
  /** たまご投稿数 */
  eggs: { direction: "up", kind: "count" },
  /** たまごの賛同数（参加したい＋開催してもいい） */
  eggReactions: { direction: "up", kind: "count" },
  /** たまごのイベント化率 */
  eggConversionRate: { direction: "up", kind: "rate" },
  /** たまご1件あたりの賛同数 */
  avgReactionsPerEgg: { direction: "up", kind: "avg" },

  // --- コミュニティ固有 ---
  /** 初参加の割合（新しい人が入る余地があるか） */
  newcomerRate: { direction: "up", kind: "rate" },
  /** 初参加の人数 */
  newcomers: { direction: "up", kind: "count" },
  /** 以前にも来ていた人数 */
  regulars: { direction: "up", kind: "count" },
  /** フォローしている人数 */
  members: { direction: "up", kind: "count" },
  /** うち期間内に参加した人数 */
  activeMembers: { direction: "up", kind: "count" },
  /** 休眠会員率（減ったら良い） */
  dormantRate: { direction: "down", kind: "rate" },
} as const satisfies Record<string, KpiMetricMeta>;

/** 前期間比を出せる指標のキー */
export type KpiMetricKey = keyof typeof KPI_METRICS;

/** 前期間の値。全期間（days=null）を選んだときは前期間が存在しないので payload ごと null。
 * 個々の値は、その期間に算出できなかった率のとき null（分母0・母数不足） */
export type KpiPreviousValues = Partial<Record<KpiMetricKey, number | null>>;

/** 増減の良し悪し。方向が neutral・変化なし・判定できないときは flat（色を付けない） */
export type KpiTone = "good" | "bad" | "flat";

export interface KpiTrend {
  key: KpiMetricKey;
  direction: KpiDirection;
  kind: KpiMetricKind;
  current: number | null;
  previous: number | null;
  /** count / avg の相対変化率 ((current - previous) / previous)。出せないときは null */
  ratio: number | null;
  /** rate のポイント差 (current - previous)。0.03 なら +3.0pt。出せないときは null */
  diff: number | null;
  /** 前期間が0で今期間に値がある（変化率が無限大になるので「新規」と出す） */
  isNew: boolean;
  tone: KpiTone;
}

/** 前期間比を組み立てる。前期間が無い（全期間を選んでいる・その指標を集計していない）
 * ときは null を返し、画面は何も出さない。
 *
 * 数字の出し方:
 *   - count / avg … 相対変化率。ただし今期間・前期間の大きい方が
 *                    KPI_TREND_MIN_SAMPLE 未満なら率を出さない（1→2 が +100% になるため）
 *   - rate        … ポイント差。率の相対変化率は「10%が11%になって+10%」のように誤読される
 *   - 前期間が0   … 変化率は Infinity になるので出さず isNew（画面は「新規」）
 *
 * 色（tone）は KPI_METRICS の方向に従って反転する。減ったら良い指標
 * （キャンセル率・不発率・休眠会員率・退会数など）は、**減少が good**。 */
export function kpiTrend(
  key: KpiMetricKey,
  current: number | null,
  previous: number | null | undefined,
): KpiTrend | null {
  if (previous === undefined) return null;
  const meta = KPI_METRICS[key] as KpiMetricMeta;
  const base: KpiTrend = {
    key,
    direction: meta.direction,
    kind: meta.kind,
    current,
    previous,
    ratio: null,
    diff: null,
    isNew: false,
    tone: "flat",
  };
  if (current === null || previous === null) return base;

  // 率はポイント差。母数ゲートは率そのものの算出時（サーバー側）に掛かっている
  if (meta.kind === "rate") {
    const diff = current - previous;
    return { ...base, diff, tone: toneOf(meta.direction, diff) };
  }

  // 件数・平均は小さすぎる母数で率を出さない（前期間の値そのものは出す）
  if (Math.max(Math.abs(current), Math.abs(previous)) < KPI_TREND_MIN_SAMPLE) {
    return base;
  }
  if (previous === 0) {
    return { ...base, isNew: true, tone: toneOf(meta.direction, current) };
  }
  const ratio = (current - previous) / previous;
  return { ...base, ratio, tone: toneOf(meta.direction, ratio) };
}

function toneOf(direction: KpiDirection, change: number): KpiTone {
  if (direction === "neutral" || change === 0) return "flat";
  return change > 0 === (direction === "up") ? "good" : "bad";
}

/* ---------------- 時系列（推移グラフ）---------------- */

/** 時系列の粒度。日次か週次か */
export type KpiGranularity = "day" | "week";

/** 日次のまま出す上限の日数。これを超えたら週次にまとめる。
 * 画面の期間選択は 7 / 30 / 90 / 365 / 全期間 なので、30日までが日次・
 * 90日以上が週次になる（issue #266 の「30日以下は日次 / 90日以上は週次」）。 */
export const KPI_DAILY_MAX_DAYS = 60;

export function kpiGranularity(dayCount: number): KpiGranularity {
  return dayCount <= KPI_DAILY_MAX_DAYS ? "day" : "week";
}

/** 推移グラフ1点分。値が null の系列は「その日は計測していない」
 * （DAU/MAU は計測開始 (#257) より前の日を 0 と描くと「誰も居なかった」に見える） */
export interface KpiSeriesPoint {
  /** JST の 'YYYY-MM-DD'。週次のときは週の**月曜**の日付 */
  day: string;
  values: Record<string, number | null>;
}

/** JST の 'YYYY-MM-DD' に日数を足す。時刻を持たない日付だけの計算なので UTC 正午で扱う
 * （夏時間の無い JST でもタイムゾーン変換を挟むと日がずれることがある） */
export function addDays(day: string, delta: number): string {
  const t = Date.parse(`${day}T12:00:00Z`);
  return new Date(t + delta * 86400000).toISOString().slice(0, 10);
}

/** その日を含む週の月曜（JST の 'YYYY-MM-DD'） */
export function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  // getUTCDay: 0=日曜。月曜始まりにするので日曜は6日戻す
  const back = (d.getUTCDay() + 6) % 7;
  return addDays(day, -back);
}

/** 日次の点を週次にまとめる。
 *
 * - 件数の系列は合計、`averageKeys` に挙げた系列（DAU など「その日の人数」）は平均、
 *   `lastKeys` に挙げた系列（MAU など「その時点の状態」）は週の最終日の値を使う。
 *   DAU を7日ぶん足すと延べ人数になり、MAU を足すと意味の無い数になる。
 * - **期間の端の欠けた週は落とす**。3日しかない週を7日の週と並べると、
 *   落ち込んだように見えて誤読する。 */
export function toWeekly(
  points: KpiSeriesPoint[],
  opts: { averageKeys?: string[]; lastKeys?: string[] } = {},
): KpiSeriesPoint[] {
  const avg = new Set(opts.averageKeys ?? []);
  const last = new Set(opts.lastKeys ?? []);
  const buckets = new Map<string, KpiSeriesPoint[]>();
  for (const p of points) {
    const w = weekStart(p.day);
    const arr = buckets.get(w);
    if (arr) arr.push(p);
    else buckets.set(w, [p]);
  }
  const out: KpiSeriesPoint[] = [];
  for (const [w, days] of [...buckets.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    if (days.length < 7) continue; // 端の不完全な週は出さない
    const keys = new Set<string>();
    for (const d of days) for (const k of Object.keys(d.values)) keys.add(k);
    const values: Record<string, number | null> = {};
    for (const k of keys) {
      const vals = days.map((d) => d.values[k] ?? null);
      const known = vals.filter((v): v is number => v !== null);
      if (known.length === 0) {
        values[k] = null;
      } else if (last.has(k)) {
        // 週の最終日の値。最終日が未計測なら分かっている最後の日
        values[k] = known[known.length - 1]!;
      } else if (avg.has(k)) {
        values[k] = known.reduce((a, b) => a + b, 0) / known.length;
      } else {
        values[k] = known.reduce((a, b) => a + b, 0);
      }
    }
    out.push({ day: w, values });
  }
  return out;
}

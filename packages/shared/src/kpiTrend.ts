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
  // アクティベーション率（登録→初回参加 / 登録→初回主催）はここに**入れない**。
  // 分子の「1度でも参加/主催したか」に期間の縛りが無く「これまでに」で見るため、
  // 前期間に登録した人は今期間ぶんだけ猶予が長い。横ばいのデータでも
  // 前期間の方が必ず高く出て、恒常的に「悪化（赤）」に寄る。
  // 正しく比べるには「登録から N 日以内に参加したか」を揃えたコホート指標に
  // 定義し直す必要があり、それは #266（推移を出す）の範囲を超えるので、
  // ここでは前期間比そのものを出さない（タイルの値だけ出す）。

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

/** 時系列の粒度。日次・週次・月次 */
export type KpiGranularity = "day" | "week" | "month";

/** 日次のまま出す上限の日数。これを超えたら週次にまとめる。
 * 画面の期間選択は 7 / 30 / 90 / 365 / 全期間 なので、30日までが日次・
 * 90日以上が週次になる（issue #266 の「30日以下は日次 / 90日以上は週次」）。 */
export const KPI_DAILY_MAX_DAYS = 60;

/** 週次で出す上限の日数。これを超えたら月次にまとめる (#292)。
 * 180日 ≒ 26週。棒は1本20pxなので、26本ならスクロールせずにおおむね収まる。
 * 1年（52週）を週次で並べると横に長すぎて形が読めないので、月次に落とす。
 * 1年 → 12本、全期間 → 年12本ずつ。 */
export const KPI_WEEKLY_MAX_DAYS = 180;

export function kpiGranularity(dayCount: number): KpiGranularity {
  if (dayCount <= KPI_DAILY_MAX_DAYS) return "day";
  return dayCount <= KPI_WEEKLY_MAX_DAYS ? "week" : "month";
}

/** 推移グラフ1点分。値が null の系列は「その日は計測していない」
 * （DAU/MAU は計測開始 (#257) より前の日を 0 と描くと「誰も居なかった」に見える） */
export interface KpiSeriesPoint {
  /** JST の 'YYYY-MM-DD'。週次のときは週の**月曜**、月次のときは月の**1日** */
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

/** その日を含む月の1日（JST の 'YYYY-MM-DD'） */
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** その月の日数。月初の日付（'YYYY-MM-01'）でも月の途中の日付でも同じ結果になる */
export function daysInMonth(day: string): number {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  // Date.UTC の day=0 は「前月の最終日」。m は1始まりなので m 月の最終日になる
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 系列ごとの畳み方。
 * - 省略（合計）… 件数の系列
 * - average    … DAU など「その日の人数」。足すと延べ人数になる
 * - last       … MAU など「その時点の状態」。足すと意味の無い数になる */
export interface KpiRollupOptions {
  averageKeys?: string[];
  lastKeys?: string[];
}

/** 日次の点をまとめる共通処理。週次・月次で**同じ畳み方**になるよう1箇所に置く
 * （集計の種類が粒度によって違うと、同じ指標が週別と月別で意味を変えてしまう）。
 *
 * @param bucketOf   その日が属するバケツの代表日（週の月曜・月の1日）
 * @param fullLength そのバケツが「完全」なら何日あるはずか。端の欠けたバケツを落とす */
function rollup(
  points: KpiSeriesPoint[],
  bucketOf: (day: string) => string,
  fullLength: (bucket: string) => number,
  opts: KpiRollupOptions,
): KpiSeriesPoint[] {
  const avg = new Set(opts.averageKeys ?? []);
  const last = new Set(opts.lastKeys ?? []);
  const buckets = new Map<string, KpiSeriesPoint[]>();
  for (const p of points) {
    const b = bucketOf(p.day);
    const arr = buckets.get(b);
    if (arr) arr.push(p);
    else buckets.set(b, [p]);
  }
  const out: KpiSeriesPoint[] = [];
  for (const [b, days] of [...buckets.entries()].sort((a, b2) =>
    a[0] < b2[0] ? -1 : 1,
  )) {
    if (days.length < fullLength(b)) continue; // 端の不完全なバケツは出さない
    const keys = new Set<string>();
    for (const d of days) for (const k of Object.keys(d.values)) keys.add(k);
    const values: Record<string, number | null> = {};
    for (const k of keys) {
      const vals = days.map((d) => d.values[k] ?? null);
      const known = vals.filter((v): v is number => v !== null);
      if (known.length === 0) {
        values[k] = null;
      } else if (last.has(k)) {
        // 期末の値。最終日が未計測なら分かっている最後の日
        values[k] = known[known.length - 1]!;
      } else if (avg.has(k)) {
        values[k] = known.reduce((a, b2) => a + b2, 0) / known.length;
      } else {
        values[k] = known.reduce((a, b2) => a + b2, 0);
      }
    }
    out.push({ day: b, values });
  }
  return out;
}

/** 日次の点を週次にまとめる。点の日付は週の**月曜**。
 *
 * **期間の端の欠けた週は落とす**。3日しかない週を7日の週と並べると、
 * 落ち込んだように見えて誤読する。 */
export function toWeekly(
  points: KpiSeriesPoint[],
  opts: KpiRollupOptions = {},
): KpiSeriesPoint[] {
  return rollup(points, weekStart, () => 7, opts);
}

/** 日次の点を月次にまとめる (#292)。点の日付は月の**1日**。
 *
 * 週次と同じ考え方で、**期間の端の欠けた月は落とす**（5日しかない月を
 * 31日の月と並べると落ち込んで見える）。月の日数は 28〜31 と揃っていないので、
 * 完全かどうかはその月の実際の日数で判定する。 */
export function toMonthly(
  points: KpiSeriesPoint[],
  opts: KpiRollupOptions = {},
): KpiSeriesPoint[] {
  return rollup(points, monthStart, daysInMonth, opts);
}

/** 粒度に合わせてまとめる。日次はそのまま */
export function toGranularity(
  points: KpiSeriesPoint[],
  granularity: KpiGranularity,
  opts: KpiRollupOptions = {},
): KpiSeriesPoint[] {
  if (granularity === "week") return toWeekly(points, opts);
  if (granularity === "month") return toMonthly(points, opts);
  return points;
}

/** イベント画像（1200×630）をテンプレートから生成するための定義とレンダラ。 */
export const OG_W = 1200;
export const OG_H = 630;

export interface FontDef {
  label: string;
  family: string; // CSS font-family 名
  weight: number;
  category: "ゴシック" | "丸ゴシック" | "明朝" | "手書き・個性派";
}

/** Google Fonts（オンデマンド読込）。日本語対応の表示用フォントを幅広く。 */
export const FONTS: FontDef[] = [
  { label: "Noto Sans", family: "Noto Sans JP", weight: 700, category: "ゴシック" },
  { label: "M PLUS 1p", family: "M PLUS 1p", weight: 800, category: "ゴシック" },
  { label: "BIZ UDPGothic", family: "BIZ UDPGothic", weight: 700, category: "ゴシック" },
  { label: "Sawarabi Gothic", family: "Sawarabi Gothic", weight: 400, category: "ゴシック" },
  { label: "Zen Kaku Gothic", family: "Zen Kaku Gothic New", weight: 700, category: "ゴシック" },
  { label: "IBM Plex Sans", family: "IBM Plex Sans JP", weight: 700, category: "ゴシック" },
  { label: "M PLUS Rounded", family: "M PLUS Rounded 1c", weight: 800, category: "丸ゴシック" },
  { label: "Zen Maru Gothic", family: "Zen Maru Gothic", weight: 700, category: "丸ゴシック" },
  { label: "Kosugi Maru", family: "Kosugi Maru", weight: 400, category: "丸ゴシック" },
  { label: "Mochiy Pop", family: "Mochiy Pop One", weight: 400, category: "丸ゴシック" },
  { label: "RocknRoll One", family: "RocknRoll One", weight: 400, category: "丸ゴシック" },
  { label: "Noto Serif", family: "Noto Serif JP", weight: 700, category: "明朝" },
  { label: "Shippori Mincho", family: "Shippori Mincho", weight: 700, category: "明朝" },
  { label: "Zen Old Mincho", family: "Zen Old Mincho", weight: 700, category: "明朝" },
  { label: "Sawarabi Mincho", family: "Sawarabi Mincho", weight: 400, category: "明朝" },
  { label: "Kaisei Decol", family: "Kaisei Decol", weight: 700, category: "明朝" },
  { label: "Shippori Antique", family: "Shippori Antique", weight: 400, category: "明朝" },
  { label: "Dela Gothic", family: "Dela Gothic One", weight: 400, category: "手書き・個性派" },
  { label: "Reggae One", family: "Reggae One", weight: 400, category: "手書き・個性派" },
  { label: "Train One", family: "Train One", weight: 400, category: "手書き・個性派" },
  { label: "Yuji Syuku", family: "Yuji Syuku", weight: 400, category: "手書き・個性派" },
  { label: "Yusei Magic", family: "Yusei Magic", weight: 400, category: "手書き・個性派" },
  { label: "Hachi Maru Pop", family: "Hachi Maru Pop", weight: 400, category: "手書き・個性派" },
  { label: "Klee One", family: "Klee One", weight: 600, category: "手書き・個性派" },
  { label: "Stick", family: "Stick", weight: 400, category: "手書き・個性派" },
  { label: "DotGothic16", family: "DotGothic16", weight: 400, category: "手書き・個性派" },
];

export interface BackgroundDef {
  label: string;
  /** タイトル/サブの文字色 */
  fg: string;
  sub: string;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

const fill = (c: string) => (ctx: CanvasRenderingContext2D) => {
  ctx.fillStyle = c;
  ctx.fillRect(0, 0, OG_W, OG_H);
};

const NIGHT = "#0E1426";

/** 同じ種を渡せば毎回同じ絵になる乱数。プレビューと保存される画像が
 * 食い違わないよう、描画のたびに変わる Math.random は使わない */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/** 小さな光の粒（既存の「花火」の柄）。文字の背後が濃くなりすぎないよう
 * 四隅寄りに置く */
function drawSparks(
  ctx: CanvasRenderingContext2D,
  bursts: [number, number, string][],
) {
  for (const [cx, cy, color] of bursts) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.5;
    for (let a = 0; a < 8; a++) {
      const ang = (a * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * 36, cy + Math.sin(ang) * 36);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/** 光の粒を四隅に散らす夜空。色だけ差し替えれば別の柄になる */
const sparkNight =
  (colors: [string, string, string, string]) =>
  (ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = NIGHT;
    ctx.fillRect(0, 0, OG_W, OG_H);
    drawSparks(ctx, [
      [170, 140, colors[0]],
      [1010, 110, colors[1]],
      [1070, 500, colors[2]],
      [120, 470, colors[3]],
    ]);
  };

export const BACKGROUNDS: BackgroundDef[] = [
  {
    label: "ダーク",
    fg: "#F8FAFC",
    sub: "#94A3B8",
    draw: fill("#0E1426"),
  },
  {
    label: "花火",
    fg: "#F8FAFC",
    sub: "#CBD5E1",
    draw: sparkNight(["#2DD4BF", "#FB923C", "#FB7185", "#FBBF24"]),
  },
  {
    label: "花火（暖色）",
    fg: "#F8FAFC",
    sub: "#CBD5E1",
    draw: sparkNight(["#FBBF24", "#FB7185", "#FB923C", "#F472B6"]),
  },
  {
    label: "花火（寒色）",
    fg: "#F8FAFC",
    sub: "#CBD5E1",
    draw: sparkNight(["#38BDF8", "#2DD4BF", "#A78BFA", "#818CF8"]),
  },
  {
    label: "打ち上げ花火",
    fg: "#F8FAFC",
    sub: "#CBD5E1",
    draw: (ctx) => {
      ctx.fillStyle = NIGHT;
      ctx.fillRect(0, 0, OG_W, OG_H);
      // 大きく開いた花火。中央は文字が乗るので、左右の端に寄せて開かせる
      const shells: [number, number, number, string][] = [
        [210, 210, 150, "#FBBF24"],
        [1000, 300, 190, "#FB7185"],
      ];
      const rnd = seeded(7);
      for (const [cx, cy, r, color] of shells) {
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineCap = "round";
        for (let a = 0; a < 24; a++) {
          const ang = (a * Math.PI) / 12;
          // 光の筋は中心から少し離れた位置で始める（芯を白く飛ばさない）
          const from = r * 0.28;
          const to = r * (0.78 + rnd() * 0.22);
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * from, cy + Math.sin(ang) * from);
          ctx.lineTo(cx + Math.cos(ang) * to, cy + Math.sin(ang) * to);
          ctx.stroke();
          // 筋の先の粒。散り際の見え方に寄せて、先端ほど明るく小さく
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(ang) * to, cy + Math.sin(ang) * to, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    },
  },
  {
    label: "紙吹雪",
    fg: "#F8FAFC",
    sub: "#CBD5E1",
    draw: (ctx) => {
      ctx.fillStyle = NIGHT;
      ctx.fillRect(0, 0, OG_W, OG_H);
      const colors = ["#2DD4BF", "#FB923C", "#FB7185", "#FBBF24", "#818CF8"];
      const rnd = seeded(21);
      for (let i = 0; i < 90; i++) {
        const x = rnd() * OG_W;
        const y = rnd() * OG_H;
        // 中央は文字が乗るので薄くする（読みにくさを持ち込まない）
        const centerish =
          Math.abs(x - OG_W / 2) < OG_W * 0.28 &&
          Math.abs(y - OG_H / 2) < OG_H * 0.3;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rnd() * Math.PI);
        ctx.globalAlpha = centerish ? 0.16 : 0.55 + rnd() * 0.35;
        ctx.fillStyle = colors[i % colors.length]!;
        ctx.fillRect(-6, -3, 12, 6);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    label: "星空",
    fg: "#F8FAFC",
    sub: "#94A3B8",
    draw: (ctx) => {
      ctx.fillStyle = "#0A1020";
      ctx.fillRect(0, 0, OG_W, OG_H);
      const rnd = seeded(97);
      // 小さな星をたくさん。花火より静かで、長いタイトルでも読める
      for (let i = 0; i < 220; i++) {
        const x = rnd() * OG_W;
        const y = rnd() * OG_H;
        const r = 0.6 + rnd() * 1.8;
        ctx.globalAlpha = 0.25 + rnd() * 0.6;
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // 数個だけ十字の光をつけて、のっぺりさせない
      const shines: [number, number, number, string][] = [
        [180, 150, 16, "#FBBF24"],
        [1030, 120, 13, "#38BDF8"],
        [1060, 500, 15, "#F8FAFC"],
        [140, 480, 12, "#2DD4BF"],
      ];
      for (const [x, y, len, color] of shines) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(x - len, y);
        ctx.lineTo(x + len, y);
        ctx.moveTo(x, y - len);
        ctx.lineTo(x, y + len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    label: "ティール",
    fg: "#06201C",
    sub: "#0F3A33",
    draw: fill("#2DD4BF"),
  },
  {
    label: "アンバー",
    fg: "#1A1206",
    sub: "#3A2A10",
    draw: fill("#FB923C"),
  },
  {
    label: "ライト",
    fg: "#111827",
    sub: "#6B7280",
    draw: fill("#F4F4F5"),
  },
  {
    label: "ドット",
    fg: "#F8FAFC",
    sub: "#94A3B8",
    draw: (ctx) => {
      ctx.fillStyle = "#15233F";
      ctx.fillRect(0, 0, OG_W, OG_H);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      for (let y = 40; y < OG_H; y += 56)
        for (let x = 40; x < OG_W; x += 56) {
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
    },
  },
];

export type LayoutKey = "center" | "left" | "top";
export const LAYOUTS: { key: LayoutKey; label: string }[] = [
  { key: "center", label: "中央" },
  { key: "left", label: "左寄せ" },
  { key: "top", label: "上寄せ" },
];

/** Google Fonts をオンデマンドで読み込む（同一familyは一度だけ）。 */
const loaded = new Set<string>();
export async function loadFont(font: FontDef): Promise<void> {
  if (!loaded.has(font.family)) {
    loaded.add(font.family);
    const href = `https://fonts.googleapis.com/css2?family=${font.family.replace(
      / /g,
      "+",
    )}:wght@${font.weight}&display=swap&text=${encodeURIComponent(
      "イベントの告知募集採点表彰配信プレゼンハッカソンアイディアソン会議勉強交流もくもく0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ年月日時分〜・！？",
    )}`;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }
  try {
    await document.fonts.load(`${font.weight} 64px "${font.family}"`);
    await document.fonts.ready;
  } catch {
    /* フォント読込失敗時は既定フォントで描画 */
  }
}

export interface RenderOpts {
  title: string;
  subtitle?: string; // 日付など（任意）
  font: FontDef;
  background: BackgroundDef;
  layout: LayoutKey;
  /** タイトルの基準サイズ(px)。長い場合は収まるよう自動縮小。既定96 */
  titleSize?: number;
}

/** タイトルを指定幅に収まるよう改行＋自動縮小して行配列を返す */
function fitLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  family: string,
  weight: number,
  maxWidth: number,
  maxHeight: number,
  startSize = 96,
): { lines: string[]; fontSize: number; lineHeight: number } {
  for (let size = startSize; size >= 28; size -= 4) {
    ctx.font = `${weight} ${size}px "${family}", sans-serif`;
    const lineHeight = size * 1.25;
    const lines: string[] = [];
    let cur = "";
    for (const ch of text) {
      if (ch === "\n") {
        lines.push(cur);
        cur = "";
        continue;
      }
      if (ctx.measureText(cur + ch).width > maxWidth && cur) {
        lines.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length * lineHeight <= maxHeight && lines.length <= 5) {
      return { lines, fontSize: size, lineHeight };
    }
  }
  ctx.font = `${weight} 36px "${family}", sans-serif`;
  return { lines: [text], fontSize: 36, lineHeight: 45 };
}

/** テンプレートに従って canvas にイベント画像を描画 */
export function drawEventImage(
  canvas: HTMLCanvasElement,
  opts: RenderOpts,
): void {
  canvas.width = OG_W;
  canvas.height = OG_H;
  const ctx = canvas.getContext("2d")!;
  opts.background.draw(ctx);

  const pad = 90;
  const maxW = OG_W - pad * 2;
  const maxH = OG_H - pad * 2 - (opts.subtitle ? 60 : 0);
  const { lines, lineHeight } = fitLines(
    ctx,
    opts.title || "（タイトル）",
    opts.font.family,
    opts.font.weight,
    maxW,
    maxH,
    opts.titleSize ?? 96,
  );

  const align: CanvasTextAlign = opts.layout === "center" ? "center" : "left";
  ctx.textAlign = align;
  ctx.fillStyle = opts.background.fg;
  const x = align === "center" ? OG_W / 2 : pad;

  const blockH = lines.length * lineHeight;
  let topY: number;
  if (opts.layout === "top") topY = pad + lineHeight * 0.8;
  else if (opts.layout === "left")
    topY = (OG_H - blockH) / 2 + lineHeight * 0.8;
  else topY = (OG_H - blockH) / 2 + lineHeight * 0.8;

  lines.forEach((ln, i) => ctx.fillText(ln, x, topY + i * lineHeight));

  if (opts.subtitle) {
    ctx.font = `400 30px "${opts.font.family}", sans-serif`;
    ctx.fillStyle = opts.background.sub;
    ctx.fillText(opts.subtitle, x, topY + blockH + 24);
  }

  // 右下に events lab マーク
  ctx.textAlign = "right";
  ctx.font = `700 26px "${opts.font.family}", sans-serif`;
  ctx.fillStyle = opts.background.sub;
  ctx.fillText("events lab", OG_W - pad, OG_H - 48);
}

/** タイトルからOG画像を自動生成（画像未設定イベント用）。フォント・背景はランダム */
export async function generateEventImageBlob(
  title: string,
  subtitle?: string,
): Promise<Blob | null> {
  const font = FONTS[Math.floor(Math.random() * FONTS.length)];
  const background = BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)];
  try {
    await loadFont(font);
  } catch {
    // フォント読込失敗でもフォールバックフォントで描画
  }
  const canvas = document.createElement("canvas");
  drawEventImage(canvas, { title, subtitle, font, background, layout: "center" });
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
}

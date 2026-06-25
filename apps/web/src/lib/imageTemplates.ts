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

export const BACKGROUNDS: BackgroundDef[] = [
  {
    label: "ダーク",
    fg: "#F8FAFC",
    sub: "#94A3B8",
    draw: fill("#0E1426"),
  },
  {
    label: "夏祭り",
    fg: "#F8FAFC",
    sub: "#CBD5E1",
    draw: (ctx) => {
      const g = ctx.createLinearGradient(0, 0, OG_W, OG_H);
      g.addColorStop(0, "#134E4A");
      g.addColorStop(1, "#7C2D12");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, OG_W, OG_H);
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
}

/** タイトルを指定幅に収まるよう改行＋自動縮小して行配列を返す */
function fitLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  family: string,
  weight: number,
  maxWidth: number,
  maxHeight: number,
): { lines: string[]; fontSize: number; lineHeight: number } {
  for (let size = 96; size >= 36; size -= 4) {
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

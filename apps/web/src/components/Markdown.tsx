import { Box } from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

/**
 * 生HTMLのサニタイズ方針（XSS対策の要）:
 * - defaultSchema（GitHub相当）をベースに、許可タグは Markdown 由来タグ＋ a / img のみ。
 *   script / iframe / style / div / span、on* イベント属性などはすべて除去される。
 * - a: href のみ許可（プロトコルは defaultSchema 準拠 = http/https/mailto等・相対URL可）。
 *   target/rel は下の components で描画側が強制する（_blank + noopener noreferrer）。
 * - img: src（http/https のみ）・alt・width・height を許可。
 */
const sanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  // div / span は Markdown 由来では使わないため許可しない（生HTMLの持ち込みを最小化）
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (t) => t !== "div" && t !== "span",
  ),
  attributes: {
    ...defaultSchema.attributes,
    a: ["href"],
    img: ["src", "alt", "width", "height"],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ["http", "https"],
  },
};

/** YouTube 動画URLから videoId と開始秒を取り出す。対象外URLは null */
function parseYouTube(href?: string): { id: string; start: number } | null {
  if (!href) return null;
  try {
    const u = new URL(href);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    let id: string | null = null;
    if (host === "youtu.be") {
      id = u.pathname.slice(1).split("/")[0] || null;
    } else if (host === "youtube.com" || host === "music.youtube.com") {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else {
        const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]+)/);
        if (m) id = m[2];
      }
    }
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    const t = u.searchParams.get("t") ?? u.searchParams.get("start") ?? "";
    const start = /^\d+s?$/.test(t) ? parseInt(t, 10) : 0;
    return { id, start };
  } catch {
    return null;
  }
}

/** プライバシー強化モード（youtube-nocookie.com）の埋め込みプレイヤー */
function YouTubeEmbed({ id, start }: { id: string; start: number }) {
  return (
    <Box
      component="iframe"
      src={`https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ""}`}
      title="YouTube動画"
      loading="lazy"
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      sx={{
        display: "block",
        width: "100%",
        maxWidth: 640,
        aspectRatio: "16 / 9",
        border: 0,
        borderRadius: 1,
        my: 1,
      }}
    />
  );
}

/** パス部分の拡張子で画像URLか判定（?rlkey=... などのクエリは無視）。表示には元URL（クエリ込み）を使う。 */
function isImageUrl(href?: string): boolean {
  if (!href) return false;
  const path = href.split("?")[0].split("#")[0];
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path);
}

/** イベント本文などを安全に Markdown 描画。GFM対応。
 * 生HTMLは rehype-raw で解釈しつつ rehype-sanitize で a / img 以外を除去（XSS対策）。 */
export function Markdown({ children }: { children: string }) {
  return (
    <Box
      sx={{
        wordBreak: "break-word",
        "& > :first-of-type": { mt: 0 },
        "& > :last-child": { mb: 0 },
        "& p": { my: 1, lineHeight: 1.8 },
        "& h1": { fontSize: "1.5rem", mt: 2.5, mb: 1, fontWeight: 700 },
        "& h2": { fontSize: "1.25rem", mt: 2.5, mb: 1, fontWeight: 700 },
        "& h3": { fontSize: "1.1rem", mt: 2, mb: 1, fontWeight: 700 },
        "& ul, & ol": { pl: 3, my: 1 },
        "& li": { mb: 0.5 },
        "& code": {
          px: 0.6,
          py: 0.2,
          bgcolor: "action.hover",
          borderRadius: 0.5,
          fontFamily: "monospace",
          fontSize: "0.9em",
        },
        "& pre": {
          p: 1.5,
          my: 1.5,
          bgcolor: "action.hover",
          borderRadius: 1,
          overflowX: "auto",
        },
        "& pre code": { p: 0, bgcolor: "transparent" },
        "& blockquote": {
          borderLeft: "3px solid",
          borderColor: "divider",
          pl: 2,
          my: 1.5,
          color: "text.secondary",
        },
        "& img": { maxWidth: "100%", borderRadius: 1 },
        "& hr": {
          border: 0,
          borderTop: "1px solid",
          borderColor: "divider",
          my: 2,
        },
        "& table": { borderCollapse: "collapse", my: 1.5, width: "auto" },
        "& th, & td": {
          border: "1px solid",
          borderColor: "divider",
          px: 1,
          py: 0.5,
        },
        "& a": { color: "primary.main", textDecoration: "underline" },
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={{
          a({ node: _node, href, children, ...props }) {
            // 裸のYouTubeリンク（リンク文字列がURLそのもの）は埋め込みプレイヤーに。
            // [テキスト](url) 形式は書き手の意図を尊重して通常リンクのまま
            const yt = parseYouTube(href);
            if (yt && String(children) === href) {
              return <YouTubeEmbed id={yt.id} start={yt.start} />;
            }
            // 裸の画像URL（クエリ付き含む）は画像として表示。タップで原寸を別タブ
            if (isImageUrl(href)) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-block" }}
                >
                  <img src={href} alt="" loading="lazy" />
                </a>
              );
            }
            return (
              <a
                {...props}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </Box>
  );
}

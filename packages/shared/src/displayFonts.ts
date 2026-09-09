import { z } from "zod";

/** Shared choices for the event-image studio and organizer cards. */
export const DISPLAY_FONTS = [
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
] as const;
export const cardFontSchema = z.enum(["default", ...DISPLAY_FONTS.map(f => f.family)]);
export type CardFont = z.infer<typeof cardFontSchema>;

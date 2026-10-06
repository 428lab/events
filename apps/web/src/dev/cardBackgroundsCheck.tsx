/** 名札のビルトイン背景の見本帳（開発用、card-backgrounds-check.html から開く）。
 *
 * ?view=overview          全背景の既定配色
 * ?view=sheet&bg=KEY      1つの背景の全配色
 * ?view=print&bg=KEY&palette=KEY  実寸（1074x650）1枚
 * ?view=bg&bg=KEY&palette=KEY     背景だけを実寸で（文字の下のコントラストとインク量の計測用）
 * ?view=existing&variant=KEY&theme=KEY  ライセンスカードの既存の地紋を白地に（比べる基準）
 *
 * 既定テンプレート（createCardTemplate("name")）の部品を、配色の文字色に塗り替えて上に重ねる。 */
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/700.css";
import ReactDOM from "react-dom/client";
import { createCardTemplate, CARD_DESIGN_HEIGHT, CARD_DESIGN_WIDTH, type CardLayout, type CardPart, type EventNameCard } from "@eventer/shared";
import "../i18n/index.js";
import { EventCardSvg, type EventCardContext } from "../components/licenseCard/EventCardSvg.js";
import { BuiltinBackgroundLayer } from "../components/licenseCard/BuiltinBackgroundLayer.js";
import { BackgroundPattern } from "../components/licenseCard/CardDecor.js";
import { BG_VARIANTS, CARD_THEMES } from "../components/licenseCard/cardTheme.js";
import {
  BUILTIN_BACKGROUNDS, builtinBackgroundMarkup, builtinBackgroundNodes,
  type BuiltinBackground, type BuiltinBackgroundPalette,
} from "../components/licenseCard/builtinBackgrounds.js";

const card: EventNameCard = {
  id: "sample", role: "participant", slotId: "s1", slotName: "LT登壇 14:00〜",
  handle: "hanako_dev", name: "山田 花子", avatarUrl: null, cardImageKey: null, createdAt: 0,
  participation: { attended: 12, noShow: 0, hosted: 2, spoken: 3 },
  gamification: { xp: 1200, level: 7, currentLevelXp: 1000, nextLevelXp: 1500, badges: [] },
  communities: [], noPhoto: false,
};
const context: EventCardContext = {
  eventId: "sample", title: "TechFes Tokyo 2025", eventUrl: "https://events.kojira.io/events/sample",
  origin: "https://events.kojira.io", communityName: "428lab コミュニティ", communityLogo: null,
};
const template = createCardTemplate("name").common;
/** 既定テンプレートの部品を配色の文字色へ塗り替える（位置・大きさはそのまま） */
function layoutFor(p: BuiltinBackgroundPalette): CardLayout {
  const color: Record<string, string> = {
    "role-band": p.accent, "event-title": p.accent,
    community: p.inkSub, handle: p.inkSub, slot: p.inkSub, name: p.ink, role: p.accent,
  };
  const parts = template.parts.map(part => "color" in part && color[part.id]
    ? { ...part, color: color[part.id]! } as CardPart : part);
  // 背景は下の層に描くので、EventCardSvg の地の矩形は塗らない（見本ページだけの重ね方）
  return { background: { ...template.background, color: "none" }, parts };
}
function SampleCard({ bg, palette, width }: { bg: BuiltinBackground; palette: BuiltinBackgroundPalette; width: number }) {
  const id = `${bg.key}-${palette.key}`;
  return <figure style={{ margin: 0, width }} data-sample={id}>
    <div style={{ position: "relative", width, aspectRatio: `${CARD_DESIGN_WIDTH} / ${CARD_DESIGN_HEIGHT}`, boxShadow: "0 1px 3px rgba(0,0,0,.25)" }}>
      <svg viewBox={`0 0 ${CARD_DESIGN_WIDTH} ${CARD_DESIGN_HEIGHT}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <BuiltinBackgroundLayer nodes={builtinBackgroundNodes(bg.key, palette.key, id)} />
      </svg>
      <div style={{ position: "absolute", inset: 0 }}>
        <EventCardSvg layout={layoutFor(palette)} card={card} context={context} />
      </div>
    </div>
    {width < CARD_DESIGN_WIDTH && <figcaption style={{ font: "600 15px 'Plus Jakarta Sans', sans-serif", padding: "6px 2px", color: "#111827" }}>
      {bg.nameJa} / {bg.nameEn} — {palette.nameJa} / {palette.nameEn}（{(builtinBackgroundMarkup(bg.key, palette.key).length / 1024).toFixed(1)} KB）
    </figcaption>}
  </figure>;
}
const grid = (cols: number, children: React.ReactNode, title: string) =>
  <div style={{ padding: 24, width: "fit-content" }} data-sheet="">
    <h1 style={{ font: "800 24px 'Plus Jakarta Sans', sans-serif", margin: "0 0 16px", color: "#111827" }}>{title}</h1>
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, auto)`, gap: 20 }}>{children}</div>
  </div>;

function Page() {
  const q = new URLSearchParams(location.search);
  const view = q.get("view") ?? "overview";
  const bg = BUILTIN_BACKGROUNDS.find(b => b.key === q.get("bg")) ?? BUILTIN_BACKGROUNDS[0]!;
  if (view === "print") {
    const palette = bg.palettes.find(p => p.key === q.get("palette")) ?? bg.palettes[0]!;
    return <div style={{ padding: 0, width: CARD_DESIGN_WIDTH }} data-sheet=""><SampleCard bg={bg} palette={palette} width={CARD_DESIGN_WIDTH} /></div>;
  }
  if (view === "bg") {
    const palette = bg.palettes.find(p => p.key === q.get("palette")) ?? bg.palettes[0]!;
    return <svg data-sheet="" viewBox={`0 0 ${CARD_DESIGN_WIDTH} ${CARD_DESIGN_HEIGHT}`} width={CARD_DESIGN_WIDTH} height={CARD_DESIGN_HEIGHT} style={{ display: "block" }}>
      <BuiltinBackgroundLayer nodes={builtinBackgroundNodes(bg.key, palette.key, "bg")} />
    </svg>;
  }
  if (view === "existing") {
    // ライセンスカードの既存の地紋を白地に描く（新しい背景と並べて比べる基準）
    const theme = CARD_THEMES.find(t => t.key === q.get("theme")) ?? CARD_THEMES[0];
    const variant = BG_VARIANTS.find(v => v.key === q.get("variant"))?.key ?? "rosette";
    return <svg data-sheet="" viewBox="0 0 1074 650" width={1074} height={650} style={{ display: "block", background: "#fff" }}>
      <BackgroundPattern variant={variant} theme={theme} />
    </svg>;
  }
  if (view === "sheet")
    return grid(2, bg.palettes.map(p => <SampleCard key={p.key} bg={bg} palette={p} width={520} />), `${bg.nameJa} / ${bg.nameEn}`);
  return grid(3, BUILTIN_BACKGROUNDS.map(b => <SampleCard key={b.key} bg={b} palette={b.palettes[0]!} width={420} />),
    "名札のビルトイン背景 / Built-in name-card backgrounds");
}
/** 計測スクリプトが配色の文字色を引き、生成時間を測れるように公開する */
Object.assign(window, { BUILTIN_BACKGROUNDS, builtinBackgroundNodes, builtinBackgroundMarkup });
ReactDOM.createRoot(document.getElementById("root")!).render(<Page />);

export const PROVIDER_META: Record<
  string,
  { label: string; color: string; textColor: string }
> = {
  discord: { label: "Discord", color: "#5865F2", textColor: "#fff" },
  google: { label: "Google", color: "#FFFFFF", textColor: "#1F1F1F" },
  github: { label: "GitHub", color: "#24292F", textColor: "#fff" },
  x: { label: "X", color: "#000000", textColor: "#fff" },
  nostr: { label: "Nostr", color: "#8E30EB", textColor: "#fff" },
  // Bluesky (#381)。ハンドルを聞いてから飛ぶので、他と違い一覧のボタンには
  // ならない（入力欄つきのフォームを画面側が置く）
  bluesky: { label: "Bluesky", color: "#0085FF", textColor: "#fff" },
};

export function providerLabel(provider: string): string {
  return PROVIDER_META[provider]?.label ?? provider;
}

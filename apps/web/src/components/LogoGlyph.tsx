/**
 * ヘッダー用の簡略ロゴグリフ（盆踊り櫓）。
 * currentColor を使うので、置かれた場所の文字色（ライト/ダーク）に追従する。
 * 精細なフルカラー版（/logo.svg）は favicon / アプリアイコン用。
 */
export function LogoGlyph({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flexShrink: 0 }}
    >
      <g fill="currentColor">
        <circle cx="32" cy="14.5" r="1.6" />
        <polygon points="32,15 11,30 53,30" />
        <circle cx="24" cy="35.5" r="2.4" />
        <circle cx="32" cy="35.5" r="2.4" />
        <circle cx="40" cy="35.5" r="2.4" />
      </g>
      <path
        d="M24 41 L40 41 L44 54 L20 54 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
      />
    </svg>
  );
}

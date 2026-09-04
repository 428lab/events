/** ライセンスカードの座標系 (#178)。
 *
 * 承認済みモックアップ type-T1.svg の 1074x650・左マージン56px グリッド。
 * ここに置くのは「複数の場所が同じ数字を指している」ものだけで、
 * 1か所でしか使わない座標は絵 (`LicenseCardSvg.tsx`) の中に直接書く。
 * 同じ数字を2度書くと、片方だけ動かしたときに絵が静かにずれる (#466)。 */

/** カードの論理サイズ（91×55mm の名刺比率） */
export const CARD_W = 1074;
export const CARD_H = 650;
/** PNG書き出しサイズ（2倍）。書き出し処理 (`LicenseCardPage.tsx`) も引く */
export const EXPORT_W = 2148;
export const EXPORT_H = 1300;

/** 左マージン。ヘッダー・表示名・パネル・コミュニティ帯・フッターの基準 */
export const MARGIN_X = 56;

/** アバター枠。クリップ・白下地・イニシャル下地・画像の4つが同じ矩形を指す */
export const AVATAR = { x: 798, y: 140, size: 220, r: 16 } as const;

/** QRパネル。描画位置であると同時に、
 * 左のコミュニティ帯が伸びてよい右端でもある（帯がQRに被らないための境界） */
export const QR = { x: 823, y: 408, size: 170 } as const;

/** 表示名とハンドルを収める幅 */
export const NAME_MAX_W = 742;

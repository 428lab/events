/**
 * 前回そのイベントで選んだ発言手段の記憶 (#332)。
 *
 * 一時鍵はサーバー側に残り続けるようになったので、「一時鍵が取れるか」だけで
 * 自動再参加を決めると、一度でも一時鍵を使った人は再読み込みのたびに黙って
 * 一時鍵へ戻され、本人の鍵で発言する選択が二度と出せなくなる。
 * そこで**選択そのもの**をイベント単位で覚えて、自動再参加の可否に使う。
 *
 * 覚えるのは「どちらを選んだか」だけ。鍵の中身や個人を特定できる値は書かない
 * （鍵はサーバーが保管する。localStorage には置かない方針＝lib/nostrChat.ts）。
 * localStorage を触る契約をこのファイルだけに閉じ込める（キーの綴りが
 * 読み書きで食い違う事故を構造的に無くす）。
 */

/** 発言に使う鍵の選び方。ephemeral=イベント用の一時鍵 / nip07=本人の鍵 */
export type KeyMode = "ephemeral" | "nip07";

function keyModeStorageKey(eventId: string): string {
  return `eventer:chatKeyMode:${eventId}`;
}

/** 前回の選択を読む。localStorage を触れない環境（プライベートウィンドウ等で
 * 例外を投げる）では「まだ何も選んでいない」扱いにして、既定の挙動に落とす */
export function loadKeyMode(eventId: string): KeyMode | null {
  try {
    const v = localStorage.getItem(keyModeStorageKey(eventId));
    return v === "ephemeral" || v === "nip07" ? v : null;
  } catch {
    return null;
  }
}

/** 選択を覚える。書けない環境では覚えないだけで、参加そのものは成立している */
export function saveKeyMode(eventId: string, mode: KeyMode): void {
  try {
    localStorage.setItem(keyModeStorageKey(eventId), mode);
  } catch {
    // 記憶できないだけなので黙って諦める（このセッション内の選択は残る）
  }
}

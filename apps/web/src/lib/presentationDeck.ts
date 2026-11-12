/** 発表画面で出すスライドの見つけ方。規則はサーバーの検証と同じ1か所（@eventer/shared presentControl.ts）。
 * 個人・チームのどちらも同じ。チームのスライドを作ると空の資料URLに `${appBaseUrl}/d/:slug` が入り
 * （teams.ts createTeamDeck）、個人は自分で貼る。外部URLは取りに行かない */
export { deckSlugFromUrl } from "@eventer/shared";

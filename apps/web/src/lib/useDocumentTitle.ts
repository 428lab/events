import { useEffect, useRef } from "react";

/** ページタイトルのサイト名 (#676)。サーバーの index.html 注入と同じ形にそろえる */
export const SITE_NAME = "events lab";

/**
 * name があればタブのタイトルを「name ・ events lab」にする (#676)。
 * name が無くなったとき・アンマウント時はマウント時の document.title に戻す。
 */
export function useDocumentTitle(name: string | null | undefined): void {
  const original = useRef<string>("");

  // 宣言順に走るので、下の effect より先にマウント時の値を控えておける
  useEffect(() => {
    const initial = document.title;
    original.current = initial;
    return () => {
      document.title = initial;
    };
  }, []);

  useEffect(() => {
    document.title = name ? `${name} ・ ${SITE_NAME}` : original.current;
  }, [name]);
}

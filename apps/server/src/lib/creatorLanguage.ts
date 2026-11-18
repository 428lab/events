import type { Context } from "hono";
import { resolveLanguage, type AppLanguage } from "@eventer/shared/i18n";
import type { AppEnv } from "../types.js";
import { usersRepo } from "../db/repositories/users.js";

/**
 * 保存される既定の文言を書く言語 = 作る人の言語 (#364)。
 *
 * 画面が `?lang=` で今の表示言語を渡す（チームの既定名と同じ形）。無ければ本人が最後に使った
 * 画面の言語（user.language、#352）、それも無ければ日本語。
 */
export async function creatorLanguage(c: Context<AppEnv>): Promise<AppLanguage> {
  const fromQuery = c.req.query("lang");
  const { language } = await usersRepo.getLanguage(c.get("user").id);
  return resolveLanguage([fromQuery, language]);
}

/**
 * 翻訳キーを型で縛る (#352)。
 *
 * これが無いと `t("evnts.title")` のような誤記がそのまま通り、**キー名が
 * 画面に出ます**。キーは第2段階で数百に増えるので、目視では追えません。
 *
 * 辞書は `packages/shared/src/i18n` の日本語側がキーの source
 * (`TranslationResource`)。英語側は型で同じキーを持つことが保証されているので、
 * 片方だけ見れば足ります。
 *
 * **サーバーから来た値をキーの一部に使う場合**（エラーコード・ロールなど）は
 * ここでは縛れません。その逃げ道は `tDynamic`（i18n/index.ts）に1か所だけ
 * 用意してあるので、各所で `as any` を書かないこと。
 */
import "i18next";
import type { TranslationResource } from "@eventer/shared/i18n";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: TranslationResource;
    };
  }
}

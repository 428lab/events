import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { i18next } from "../src/i18n/index.js";

// globals: true なので Testing Library の自動 cleanup も効くが、
// 設定を読み替えても取りこぼさないよう明示しておく
afterEach(() => {
  cleanup();
});

/**
 * テストの既定の表示言語は日本語 (#352)。
 *
 * jsdom の `navigator.language` は "en-US" なので、放っておくと英語で
 * 走ってしまい「日本語の画面に何が出るか」を確かめているテストが全部ずれる。
 * 英語を確かめたいテストは、そのテストの中で `changeLanguage("en")` する
 * （ここで毎回戻すので、他のテストには漏れない）。
 *
 * タイムゾーンの固定 (#322) は vitest.config.ts 側。こちらは言語だけ。
 */
beforeEach(async () => {
  await i18next.changeLanguage("ja");
});

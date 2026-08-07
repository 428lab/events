import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// globals: true なので Testing Library の自動 cleanup も効くが、
// 設定を読み替えても取りこぼさないよう明示しておく
afterEach(() => {
  cleanup();
});

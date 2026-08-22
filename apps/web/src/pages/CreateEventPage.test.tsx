import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 終了日時が開始より前のとき、入力の時点で警告する (#399)。
 *
 * これまで画面は「入力されているか」しか見ておらず、順序が逆でも送信できて
 * サーバーで初めて弾かれていた（利用者には「作成に失敗する」としか見えない）。
 * 終了日時の欄にエラーと説明を出し、送信ボタンを無効にする。
 */

const { createMutate } = vi.hoisted(() => ({ createMutate: vi.fn() }));

vi.mock("../api/hooks.js", () => ({
  useCreateEvent: () => ({
    mutate: createMutate,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("../api/communityHooks.js", () => ({
  useMyCommunities: () => ({ data: [] }),
}));
vi.mock("../api/requestHooks.js", () => ({
  useEventRequest: () => ({ data: undefined }),
  useLinkRequestEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { CreateEventPage } = await import("./CreateEventPage.js");

function draw() {
  return render(
    <MemoryRouter>
      <CreateEventPage />
    </MemoryRouter>,
  );
}

/** タイトルと開始・終了日時を入れる（順序は引数で変える） */
function fill(startsAt: string, endsAt: string) {
  fireEvent.change(screen.getByLabelText(/^タイトル/), {
    target: { value: "テストイベント" },
  });
  fireEvent.change(screen.getByLabelText("開始日時"), {
    target: { value: startsAt },
  });
  fireEvent.change(screen.getByLabelText("終了日時"), {
    target: { value: endsAt },
  });
}

const submitButton = () => screen.getByRole("button", { name: "作成" });

beforeEach(() => {
  createMutate.mockReset();
});

describe("イベント作成の日時順序の警告 (#399)", () => {
  it("終了が開始より前だと警告が出て作成ボタンが無効になる", () => {
    draw();
    fill("2026-09-01T10:00", "2026-09-01T09:00");
    expect(
      screen.getByText("終了日時は開始日時より後にしてください。"),
    ).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("終了を開始より後に直すと警告が消えて作成できる", () => {
    draw();
    fill("2026-09-01T10:00", "2026-09-01T09:00");
    fireEvent.change(screen.getByLabelText("終了日時"), {
      target: { value: "2026-09-01T12:00" },
    });
    expect(
      screen.queryByText("終了日時は開始日時より後にしてください。"),
    ).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it("同時刻（開始＝終了）はサーバーの検証（以降を許容）に合わせて通す", () => {
    draw();
    fill("2026-09-01T10:00", "2026-09-01T10:00");
    expect(
      screen.queryByText("終了日時は開始日時より後にしてください。"),
    ).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it("日程調整モードでは日時欄が無く、警告も誤発火しない", () => {
    draw();
    // 先に逆順の日時を入れてから日程調整へ切り替える（値は残るが判定されない）
    fill("2026-09-01T10:00", "2026-09-01T09:00");
    fireEvent.click(screen.getByLabelText(/日程調整/));
    expect(screen.queryByLabelText("終了日時")).not.toBeInTheDocument();
    expect(
      screen.queryByText("終了日時は開始日時より後にしてください。"),
    ).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });
});

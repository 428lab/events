import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * イベント編集でも、終了日時が開始より前なら入力の時点で警告する (#399)。
 *
 * 編集には「日程調整をやめて日時を直接確定する」保存 (#138) があり、この保存
 * だけはサーバーが「終了 > 開始」を要求する（同時刻も不可）。画面の判定も
 * それに合わせる。通常の編集は共有スキーマの契約（終了 >= 開始）どおり
 * 「前」だけを警告する。
 */

const { updateMutate } = vi.hoisted(() => ({ updateMutate: vi.fn() }));

let eventData: Record<string, unknown>;

vi.mock("../api/hooks.js", () => ({
  useEvent: () => ({ data: eventData, isLoading: false }),
  useIsAdmin: () => false,
  useUpdateEvent: () => ({
    mutate: updateMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
  useDeleteEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useDuplicateEvent: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  }),
}));
vi.mock("../api/communityHooks.js", () => ({
  useMyCommunities: () => ({ data: [] }),
}));
// イベント本体の編集と関係ない部品（それぞれが自前で API を呼ぶ）は外す
vi.mock("../components/EventSlotsEditor.js", () => ({
  EventSlotsEditor: () => null,
}));
vi.mock("../components/SurveyQuestionsEditor.js", () => ({
  SurveyQuestionsEditor: () => null,
}));
vi.mock("../components/AwardsEditor.js", () => ({
  AwardsEditor: () => null,
}));
vi.mock("../components/EventImageEditor.js", () => ({
  EventImageEditor: () => null,
}));

const { EditEventPage } = await import("./EditEventPage.js");

/** 2026-09-01T10:00〜12:00（Asia/Tokyo。TZ は vitest.config.ts が固定）の既定イベント */
function makeEventData(over: Record<string, unknown> = {}) {
  return {
    event: {
      id: "e-1",
      status: "draft",
      title: "テストイベント",
      subtitle: "",
      description: "",
      startsAt: new Date("2026-09-01T10:00").getTime(),
      endsAt: new Date("2026-09-01T12:00").getTime(),
      registrationDeadline: null,
      scheduling: false,
      venueType: "offline",
      venueOffline: "",
      venueOnline: "",
      contestMode: false,
      attendanceCheck: false,
      chatEnabled: false,
      chatUrlsAllowed: false,
      qaEnabled: false,
      qaAnonymity: "choice",
      venueWanted: false,
      communityId: null,
      imageUpdatedAt: null,
      ...over,
    },
    myRole: "staff",
    membersNote: "",
  };
}

function draw() {
  return render(
    <MemoryRouter initialEntries={["/events/e-1/edit"]}>
      <Routes>
        <Route path="/events/:id/edit" element={<EditEventPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const saveButton = () => screen.getByRole("button", { name: "保存" });
const orderWarning = () =>
  screen.queryByText("終了日時は開始日時より後にしてください。");

beforeEach(() => {
  updateMutate.mockReset();
  eventData = makeEventData();
});

describe("イベント編集の日時順序の警告 (#399)", () => {
  it("終了を開始より前にすると警告が出て保存ボタンが無効になる", () => {
    draw();
    fireEvent.change(screen.getByLabelText("終了日時"), {
      target: { value: "2026-09-01T09:00" },
    });
    expect(orderWarning()).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("終了を開始より後に直すと警告が消えて保存できる", () => {
    draw();
    fireEvent.change(screen.getByLabelText("終了日時"), {
      target: { value: "2026-09-01T09:00" },
    });
    fireEvent.change(screen.getByLabelText("終了日時"), {
      target: { value: "2026-09-01T13:00" },
    });
    expect(orderWarning()).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("通常の編集では同時刻（開始＝終了）を警告しない（共有スキーマは以降を許容）", () => {
    draw();
    fireEvent.change(screen.getByLabelText("終了日時"), {
      target: { value: "2026-09-01T10:00" },
    });
    expect(orderWarning()).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("日程調整中は日時欄が無く、警告も誤発火しない", () => {
    eventData = makeEventData({ scheduling: true, startsAt: 0, endsAt: 0 });
    draw();
    expect(screen.queryByLabelText("終了日時")).not.toBeInTheDocument();
    expect(orderWarning()).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("日時を直接確定する保存では、サーバーに合わせて同時刻も警告する", () => {
    eventData = makeEventData({ scheduling: true, startsAt: 0, endsAt: 0 });
    draw();
    fireEvent.click(screen.getByRole("button", { name: "日時を直接設定する" }));
    fireEvent.change(screen.getByLabelText("開始日時"), {
      target: { value: "2026-09-01T10:00" },
    });
    fireEvent.change(screen.getByLabelText("終了日時"), {
      target: { value: "2026-09-01T10:00" },
    });
    expect(orderWarning()).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });
});

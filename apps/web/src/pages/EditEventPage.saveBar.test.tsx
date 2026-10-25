import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * イベント編集の「イベントを保存」。
 * - フォームのいちばん下（複製・削除のあと）に置き、画像の保存と見分けられるようにする
 * - テンプレートで作りかけの画像があるまま保存しようとしたら、反映するかを聞く
 */

const { updateMutate, applyPendingImage } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  applyPendingImage: vi.fn(),
}));

vi.mock("../api/hooks.js", () => ({
  useEvent: () => ({ data: eventData, isLoading: false, refetch: vi.fn() }),
  useIsAdmin: () => false,
  useUpdateEvent: () => ({ mutate: updateMutate, isPending: false, isError: false, error: null }),
  useDeleteEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useDuplicateEvent: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));
vi.mock("../api/communityHooks.js", () => ({ useMyCommunities: () => ({ data: [] }) }));
vi.mock("../components/EventSlotsEditor.js", () => ({ EventSlotsEditor: () => null }));
vi.mock("../components/SurveyQuestionsEditor.js", () => ({ SurveyQuestionsEditor: () => null }));
vi.mock("../components/MeetPrizeEditor.js", () => ({ MeetPrizeEditor: () => null }));
vi.mock("../components/DescriptionImageTray.js", () => ({ DescriptionImageTray: () => null }));
// 画像の部品は「作りかけにする」ボタンだけを持つ代役にする（中身は EventImageStudio.test.tsx）
vi.mock("../components/EventImageEditor.js", () => ({
  EventImageEditor: forwardRef<
    { applyPendingImage: () => Promise<boolean> },
    { onPendingChange?: (pending: boolean) => void }
  >(function FakeImageEditor({ onPendingChange }, ref) {
    useImperativeHandle(ref, () => ({ applyPendingImage }));
    return (
      <button type="button" onClick={() => onPendingChange?.(true)}>
        画像を作りかけにする
      </button>
    );
  }),
}));

const { EditEventPage } = await import("./EditEventPage.js");

let eventData: Record<string, unknown>;

function makeEventData() {
  return {
    event: {
      id: "e-1",
      status: "draft",
      visibility: "public",
      accessRevision: 1,
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
      chatEncrypted: false,
      chatUrlsAllowed: false,
      chatOpenBeforeMinutes: 30,
      chatCloseAfterMinutes: 120,
      qaEnabled: false,
      qaAnonymity: "choice",
      meetRanking: "off",
      meetPrizes: false,
      warikanEnabled: false,
      venueWanted: false,
      communityId: null,
      imageUpdatedAt: null,
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
        <Route path="/events/:id" element={<div>詳細ページ</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const saveButton = () => screen.getByRole("button", { name: "イベントを保存" });
const dialog = () => screen.queryByRole("dialog");

beforeEach(() => {
  updateMutate.mockReset();
  applyPendingImage.mockReset();
  eventData = makeEventData();
});

describe("イベント編集の保存バー", () => {
  it("「イベントを保存」は複製・削除より後、フォームのいちばん下にある", () => {
    draw();
    const bar = screen.getByTestId("event-save-bar");
    expect(within(bar).getByRole("button", { name: "イベントを保存" })).toBeInTheDocument();
    const deleteButton = screen.getByRole("button", { name: "このイベントを削除" });
    const duplicateButton = screen.getByRole("button", { name: /複製/ });
    // DOCUMENT_POSITION_FOLLOWING: 保存は削除・複製より後ろ
    expect(deleteButton.compareDocumentPosition(saveButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(duplicateButton.compareDocumentPosition(saveButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  });

  it("作りかけの画像がなければ、聞かずにそのまま保存する", async () => {
    draw();
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(dialog()).not.toBeInTheDocument();
    expect(applyPendingImage).not.toHaveBeenCalled();
  });

  it("作りかけの画像があると聞く。「画像も変えて保存」で画像を反映してから保存する", async () => {
    applyPendingImage.mockResolvedValue(true);
    draw();
    fireEvent.click(screen.getByRole("button", { name: "画像を作りかけにする" }));
    fireEvent.click(saveButton());
    expect(await screen.findByText("作成中の画像がまだイベント画像になっていません。")).toBeInTheDocument();
    expect(updateMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "画像も変えて保存" }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(applyPendingImage).toHaveBeenCalledTimes(1);
    expect(applyPendingImage.mock.invocationCallOrder[0]).toBeLessThan(updateMutate.mock.invocationCallOrder[0]!);
  });

  it("「画像はそのままで保存」は画像を反映せずに保存する", async () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "画像を作りかけにする" }));
    fireEvent.click(saveButton());
    fireEvent.click(await screen.findByRole("button", { name: "画像はそのままで保存" }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(applyPendingImage).not.toHaveBeenCalled();
  });

  it("確認で「キャンセル」なら、画像も反映せず保存もしない", async () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "画像を作りかけにする" }));
    fireEvent.click(saveButton());
    const d = await screen.findByRole("dialog");
    fireEvent.click(within(d).getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(updateMutate).not.toHaveBeenCalled();
    expect(applyPendingImage).not.toHaveBeenCalled();
  });

  it("画像の反映に失敗したら、イベントは保存せずにエラーを出す", async () => {
    applyPendingImage.mockResolvedValue(false);
    draw();
    fireEvent.click(screen.getByRole("button", { name: "画像を作りかけにする" }));
    fireEvent.click(saveButton());
    fireEvent.click(await screen.findByRole("button", { name: "画像も変えて保存" }));
    expect(await screen.findByText("画像を変えられませんでした。イベントは保存していません。")).toBeInTheDocument();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("作りかけの画像があるままキャンセルすると確かめ、やめたら留まる", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    draw();
    fireEvent.click(screen.getByRole("button", { name: "画像を作りかけにする" }));
    const bar = screen.getByTestId("event-save-bar");
    fireEvent.click(within(bar).getByRole("button", { name: "キャンセル" }));
    expect(confirm).toHaveBeenCalledWith("作成中の画像がまだイベント画像になっていません。このまま編集をやめますか？");
    expect(screen.queryByText("詳細ページ")).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("スマホ幅では保存バーを画面下に固定し、カードの外（body 直下）に出す", () => {
    const original = window.matchMedia;
    // md 未満（スマホ）として振る舞う
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      const { container } = draw();
      const bar = screen.getByTestId("event-save-bar");
      expect(getComputedStyle(bar).position).toBe("fixed");
      expect(container.contains(bar)).toBe(false);
      expect(within(bar).getByRole("button", { name: "イベントを保存" })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});

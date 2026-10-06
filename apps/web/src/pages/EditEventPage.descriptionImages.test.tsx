import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDescriptionImage } from "@eventer/shared";

/**
 * 編集画面の説明文画像トレイ (D-DESC-IMAGE)。固定したい契約:
 *
 * - サムネイルを押すと、**そのトレイの入力欄**の最後のカーソル位置に `![](url)` が入る
 *   （入力欄から外れても位置を覚えている。触っていなければ末尾）
 * - × は確認のうえ画像を消し、説明文と参加者限定文章の**両方**から参照を外す
 * - 10枚に達したら「画像を追加」を押せず 10/10 を出す
 * - 選んだ画像は縮小してから送る
 */

const { updateMutate, uploadMutate, deleteMutate, resize } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  uploadMutate: vi.fn(),
  deleteMutate: vi.fn(),
  resize: vi.fn(),
}));

let eventData: Record<string, unknown>;
let images: EventDescriptionImage[];

vi.mock("../api/hooks.js", () => ({
  useEvent: () => ({ data: eventData, isLoading: false }),
  useIsAdmin: () => false,
  useUpdateEvent: () => ({ mutate: updateMutate, isPending: false, isError: false, error: null }),
  useDeleteEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useDuplicateEvent: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));
vi.mock("../api/communityHooks.js", () => ({ useMyCommunities: () => ({ data: [] }) }));
vi.mock("../api/descriptionImageHooks.js", () => ({
  useEventDescriptionImages: () => ({ data: images }),
  useUploadEventDescriptionImage: () => ({ mutateAsync: uploadMutate }),
  useDeleteEventDescriptionImage: () => ({ mutate: deleteMutate, isPending: false }),
}));
vi.mock("../lib/descriptionImages.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/descriptionImages.js")>()),
  resizeForDescription: resize,
}));
vi.mock("../components/EventSlotsEditor.js", () => ({ EventSlotsEditor: () => null }));
vi.mock("../components/SurveyQuestionsEditor.js", () => ({ SurveyQuestionsEditor: () => null }));
vi.mock("../components/AwardsEditor.js", () => ({ AwardsEditor: () => null }));
vi.mock("../components/EventImageEditor.js", () => ({ EventImageEditor: () => null }));
vi.mock("../components/MeetPrizeEditor.js", () => ({ MeetPrizeEditor: () => null }));

const { EditEventPage } = await import("./EditEventPage.js");

const img = (n: number): EventDescriptionImage => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  url: `/api/events/e-1/description-images/00000000-0000-4000-8000-00000000000${n}`,
  size: 1000,
  createdAt: n,
});

function makeEventData(description: string, membersNote: string) {
  return {
    event: {
      id: "e-1",
      status: "draft",
      visibility: "public",
      title: "テストイベント",
      subtitle: "",
      description,
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
    },
    myRole: "staff",
    membersNote,
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

const textareas = () => {
  const [description, membersNote] = screen
    .getAllByRole("textbox")
    .filter((el): el is HTMLTextAreaElement => el.tagName === "TEXTAREA" && !el.hasAttribute("aria-hidden"));
  return { description: description!, membersNote: membersNote! };
};
const trays = () => screen.getAllByTestId("description-image-tray");

beforeEach(() => {
  updateMutate.mockReset();
  uploadMutate.mockReset();
  deleteMutate.mockReset();
  resize.mockReset();
  images = [img(1), img(2)];
  eventData = makeEventData("前半\n後半", "メモ");
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("説明文画像トレイ (D-DESC-IMAGE)", () => {
  it("説明文と参加者限定文章の両方に同じ画像の一覧が出る", () => {
    draw();
    expect(trays()).toHaveLength(2);
    for (const tray of trays()) {
      expect(within(tray).getAllByRole("button", { name: "この画像を本文に差し込む" })).toHaveLength(2);
      expect(within(tray).getByText("2/10")).toBeInTheDocument();
    }
  });

  it("サムネイルを押すと、その入力欄の最後のカーソル位置に差し込む（外れても位置を覚えている）", () => {
    draw();
    const { description, membersNote } = textareas();
    // 「前半」の直後にカーソルを置いてから入力欄を離れる
    description.setSelectionRange(2, 2);
    fireEvent.select(description);
    fireEvent.blur(description);
    fireEvent.click(within(trays()[0]!).getAllByRole("button", { name: "この画像を本文に差し込む" })[0]!);
    expect(textareas().description.value).toBe(`前半\n![](${img(1).url})\n後半`);
    // もう片方の入力欄は変わらない
    expect(membersNote.value).toBe("メモ");
  });

  it("触っていない入力欄では末尾に足す", () => {
    draw();
    fireEvent.click(within(trays()[1]!).getAllByRole("button", { name: "この画像を本文に差し込む" })[1]!);
    expect(textareas().membersNote.value).toBe(`メモ\n![](${img(2).url})`);
    expect(textareas().description.value).toBe("前半\n後半");
  });

  it("× は確認のうえ画像を消し、両方の入力欄から参照を外す", () => {
    const url = img(1).url;
    eventData = makeEventData(`前半\n![](${url})\n後半 ![図](${url}) 続き\n![](${img(2).url})`, `![](${url})\nメモ`);
    deleteMutate.mockImplementation((_id: string, opts: { onSuccess: () => void }) => opts.onSuccess());
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    draw();
    const del = () => within(trays()[0]!).getAllByRole("button", { name: "この画像を削除" })[0]!;

    fireEvent.click(del());
    expect(deleteMutate).not.toHaveBeenCalled();
    expect(textareas().description.value).toContain(url);

    fireEvent.click(del());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(deleteMutate).toHaveBeenCalledWith(img(1).id, expect.anything());
    expect(textareas().description.value).toBe(`前半\n後半  続き\n![](${img(2).url})`);
    expect(textareas().membersNote.value).toBe("メモ");
  });

  it("10枚に達すると「画像を追加」を押せず 10/10 と上限の案内を出す", () => {
    images = Array.from({ length: 10 }, (_, i) => ({ ...img(0), id: `id-${i}`, url: `/u/${i}` }));
    draw();
    for (const tray of trays()) {
      expect(within(tray).getByRole("button", { name: "画像を追加" })).toBeDisabled();
      expect(within(tray).getByText("10/10")).toBeInTheDocument();
      expect(within(tray).getByText("画像は1イベント10枚までです")).toBeInTheDocument();
    }
  });

  it("選んだファイルは縮小してから送る", async () => {
    const small = new Blob(["x"], { type: "image/webp" });
    resize.mockResolvedValue(small);
    uploadMutate.mockResolvedValue(img(3));
    draw();
    const input = trays()[0]!.querySelector('input[type="file"]')!;
    const file = new File(["big"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadMutate).toHaveBeenCalledWith(small));
    expect(resize).toHaveBeenCalledWith(file);
  });
});

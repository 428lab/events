import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EventTrack, ScheduleItem } from "@eventer/shared";

/**
 * タイムテーブル編集の差分保存 (#340)。
 *
 * サーバーは送られた ID の項目を更新し、ID の無い項目を追加する。編集画面が
 * 既存の ID を送り返さないと保存のたびに作り直しになり、登壇者本人の
 * 資料URL編集 (#148) が別のコマに当たる。ID を持ち回っていることを、
 * 実際に描画して保存ボタンを押して確かめる。
 */

const { getMock, putMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...args: unknown[]) => getMock(...args),
      put: (...args: unknown[]) => putMock(...args),
    },
  };
});

const { ScheduleEditor } = await import("./ScheduleEditor.js");

function item(patch: Partial<ScheduleItem> & { id: string }): ScheduleItem {
  return {
    eventId: "e-1",
    title: "コマ",
    description: "",
    durationMin: 10,
    startsAt: null,
    speaker: null,
    speakerUserId: null,
    speakerName: "",
    materialUrl: "",
    materialOgImage: "",
    sortOrder: 0,
    // 既存のコマは全トラック共通（マイグレーションの既定値と同じ #338）
    placement: "all",
    trackIds: [],
    ...patch,
  };
}

const ITEMS: ScheduleItem[] = [
  item({ id: "it-1", title: "オープニング", sortOrder: 0 }),
  item({ id: "it-2", title: "セッション", durationMin: 30, sortOrder: 1 }),
];

function draw(items: ScheduleItem[] = ITEMS, tracks: EventTrack[] = []) {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <ScheduleEditor
        eventId="e-1"
        eventStartsAt={null}
        items={items}
        tracks={tracks}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

/** 保存ボタンを押して、送られた本文を取り出す */
async function saveAndCaptureBody(): Promise<{
  items: Array<{
    id: string | null;
    title: string;
    placement: string;
    trackIndexes: number[];
  }>;
  tracks: Array<{ id: string | null; name: string }>;
}> {
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(putMock).toHaveBeenCalled());
  const [path, body] = putMock.mock.calls.at(-1)!;
  expect(path).toBe("/events/e-1/timetable");
  return body as Awaited<ReturnType<typeof saveAndCaptureBody>>;
}

/** 保存ボタンを押して、送られた各コマの ID と内容だけ取り出す */
async function saveAndCapture(): Promise<
  Array<{ id: string | null; title: string }>
> {
  const { items } = await saveAndCaptureBody();
  return items.map((i) => ({ id: i.id, title: i.title }));
}

describe("ScheduleEditor の差分保存 (#340)", () => {
  beforeEach(() => {
    getMock.mockReset();
    putMock.mockReset();
    // 担当者候補（メンバー一覧）の取得
    getMock.mockResolvedValue({ members: [] });
    putMock.mockResolvedValue({ items: [] });
  });

  it("既存のコマは ID を付けて送る", async () => {
    draw();

    expect(await saveAndCapture()).toEqual([
      { id: "it-1", title: "オープニング" },
      { id: "it-2", title: "セッション" },
    ]);
  });

  it("並べ替えても ID は付いたまま、順序だけが入れ替わる", async () => {
    draw();

    fireEvent.click(screen.getAllByTitle("下へ移動")[0]);

    expect((await saveAndCapture()).map((i) => i.id)).toEqual(["it-2", "it-1"]);
  });

  it("追加したコマは ID 無し（新規）で送り、既存のコマの ID は変えない", async () => {
    draw();

    fireEvent.click(screen.getByRole("button", { name: "行を追加" }));
    const titles = screen.getAllByLabelText("内容");
    fireEvent.change(titles[titles.length - 1], {
      target: { value: "懇親会" },
    });

    expect(await saveAndCapture()).toEqual([
      { id: "it-1", title: "オープニング" },
      { id: "it-2", title: "セッション" },
      { id: null, title: "懇親会" },
    ]);
  });

  it("削除したコマは送られない（サーバー側で消える）", async () => {
    draw();

    fireEvent.click(screen.getAllByTitle("この行を削除")[0]);

    expect(await saveAndCapture()).toEqual([
      { id: "it-2", title: "セッション" },
    ]);
  });

  it("トラックを知っているクライアントは tracks も一緒に送る", async () => {
    draw();

    expect((await saveAndCaptureBody()).tracks).toEqual([]);
  });

  it("テンプレートで置き換えたコマは全部 ID 無しで送る", async () => {
    draw([]);

    fireEvent.click(screen.getByRole("button", { name: "テンプレから作成" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "LT会" }));

    const sent = await saveAndCapture();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((i) => i.id === null)).toBe(true);
  });
});

/**
 * トラックへの割り当て (#338)。
 *
 * **タップだけで全部の操作ができること**が要件なので、チップ・スイッチ・ボタンを
 * 実際にクリックして、送られる placement と trackIndexes を確かめる。
 * ドラッグ操作はここでは一切使っていない。
 */
const TRACKS: EventTrack[] = [
  { id: "tr-A", name: "トラックA", sortOrder: 0 },
  { id: "tr-B", name: "トラックB", sortOrder: 1 },
];

describe("ScheduleEditor のトラック割り当て (#338)", () => {
  beforeEach(() => {
    getMock.mockReset();
    putMock.mockReset();
    getMock.mockResolvedValue({ members: [] });
    putMock.mockResolvedValue({ items: [], tracks: [] });
  });

  it("既存のコマは全トラック共通のまま送られる（列の既定値での移行）", async () => {
    draw(ITEMS, TRACKS);

    const { items, tracks } = await saveAndCaptureBody();
    expect(tracks).toEqual([
      { id: "tr-A", name: "トラックA" },
      { id: "tr-B", name: "トラックB" },
    ]);
    expect(items.map((i) => i.placement)).toEqual(["all", "all"]);
    expect(items.every((i) => i.trackIndexes.length === 0)).toBe(true);
  });

  it("チップをタップすると、そのコマだけ特定のトラックになる", async () => {
    draw(ITEMS, TRACKS);

    // 1コマ目のチップ「トラックB」を押す
    fireEvent.click(screen.getAllByRole("button", { name: "トラックB" })[0]);

    const { items } = await saveAndCaptureBody();
    expect(items[0]).toMatchObject({ placement: "tracks", trackIndexes: [1] });
    expect(items[1]).toMatchObject({ placement: "all", trackIndexes: [] });
  });

  it("チップを2つ選ぶと複数トラックにまたがる", async () => {
    draw(ITEMS, TRACKS);

    fireEvent.click(screen.getAllByRole("button", { name: "トラックA" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "トラックB" })[0]);

    const { items } = await saveAndCaptureBody();
    expect(items[0]).toMatchObject({ placement: "tracks", trackIndexes: [0, 1] });
  });

  it("チップを全部外すと未割り当てに戻る（未割り当てと全トラック共通は別物）", async () => {
    draw(ITEMS, TRACKS);

    const chip = () => screen.getAllByRole("button", { name: "トラックA" })[0]!;
    fireEvent.click(chip()); // 全体共通 → トラックAだけ
    fireEvent.click(chip()); // 外す → 割り当て先が無くなる

    const { items } = await saveAndCaptureBody();
    expect(items[0]).toMatchObject({ placement: "unassigned", trackIndexes: [] });
    // 全トラック共通のコマは placement が別（対応表はどちらも空）
    expect(items[1]).toMatchObject({ placement: "all", trackIndexes: [] });
  });

  it("未割り当ての「配置する」で全トラック共通として配置される", async () => {
    draw([item({ id: "it-1", title: "ネタ", placement: "unassigned" })], TRACKS);

    expect(screen.getByText("未割り当て（参加者には出ません）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "配置する" }));

    const { items } = await saveAndCaptureBody();
    expect(items[0]).toMatchObject({ placement: "all", trackIndexes: [] });
  });

  it("「未割り当てに戻す」で配置済みからネタ出しへ戻せる", async () => {
    draw(ITEMS, TRACKS);

    fireEvent.click(screen.getAllByRole("button", { name: "未割り当てに戻す" })[0]!);

    const { items } = await saveAndCaptureBody();
    expect(items.find((i) => i.id === "it-1")).toMatchObject({
      placement: "unassigned",
    });
  });

  it("トラックを追加すると ID 無しで送られ、コマから添字で参照できる", async () => {
    draw(ITEMS, []);

    fireEvent.click(screen.getByRole("button", { name: "トラックを追加" }));
    fireEvent.change(screen.getByLabelText("トラック1の名前"), {
      target: { value: "ホールA" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "ホールA" })[0]!);

    const { items, tracks } = await saveAndCaptureBody();
    expect(tracks).toEqual([{ id: null, name: "ホールA" }]);
    expect(items[0]).toMatchObject({ placement: "tracks", trackIndexes: [0] });
  });

  it("トラックを削除すると、そのトラックにだけ載っていたコマは未割り当てに戻る", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    draw(
      [
        item({ id: "it-1", title: "A枠", placement: "tracks", trackIds: ["tr-A"] }),
        item({
          id: "it-2",
          title: "AB枠",
          placement: "tracks",
          trackIds: ["tr-A", "tr-B"],
        }),
        item({ id: "it-3", title: "全体", placement: "all" }),
      ],
      TRACKS,
    );

    fireEvent.click(screen.getAllByTitle("このトラックを削除")[0]!);

    const { items, tracks } = await saveAndCaptureBody();
    expect(tracks).toEqual([{ id: "tr-B", name: "トラックB" }]);
    // トラックAにしか載っていなかった「A枠」だけが未割り当てに戻る
    expect(items.find((i) => i.id === "it-1")).toMatchObject({
      placement: "unassigned",
      trackIndexes: [],
    });
    expect(items.find((i) => i.id === "it-2")).toMatchObject({
      placement: "tracks",
      trackIndexes: [0],
    });
    expect(items.find((i) => i.id === "it-3")).toMatchObject({
      placement: "all",
    });
  });

  it("同じトラック内で時刻が重なると警告が出るが、保存はできる", async () => {
    const base = Date.UTC(2026, 8, 12, 1, 0);
    draw(
      [
        item({ id: "it-1", title: "事例発表", durationMin: 45, startsAt: base }),
        item({
          id: "it-2",
          title: "飛び入りLT",
          durationMin: 45,
          startsAt: base + 30 * 60_000,
        }),
      ],
      [TRACKS[0]!],
    );

    const alert = screen.getByRole("alert");
    expect(
      within(alert).getByText(/同じトラック内で時刻が重なっています/),
    ).toBeTruthy();
    expect(within(alert).getByText(/事例発表/)).toBeTruthy();
    // 警告は出すが保存は止めない
    expect(
      screen.getByRole("button", { name: "保存" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("重なっていなければ警告は出ない", () => {
    const base = Date.UTC(2026, 8, 12, 1, 0);
    draw(
      [
        item({ id: "it-1", title: "事例発表", durationMin: 30, startsAt: base }),
        item({
          id: "it-2",
          title: "次の枠",
          durationMin: 30,
          startsAt: base + 30 * 60_000,
        }),
      ],
      [TRACKS[0]!],
    );

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

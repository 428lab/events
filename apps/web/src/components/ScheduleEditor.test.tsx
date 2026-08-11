import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ScheduleItem } from "@eventer/shared";

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
    ...patch,
  };
}

const ITEMS: ScheduleItem[] = [
  item({ id: "it-1", title: "オープニング", sortOrder: 0 }),
  item({ id: "it-2", title: "セッション", durationMin: 30, sortOrder: 1 }),
];

function draw(items: ScheduleItem[] = ITEMS) {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <ScheduleEditor
        eventId="e-1"
        eventStartsAt={null}
        items={items}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

/** 保存ボタンを押して、送られた各コマの ID と内容だけ取り出す */
async function saveAndCapture(): Promise<
  Array<{ id: string | null; title: string }>
> {
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(putMock).toHaveBeenCalled());
  const [path, body] = putMock.mock.calls.at(-1)!;
  expect(path).toBe("/events/e-1/timetable");
  const { items } = body as {
    items: Array<{ id: string | null; title: string }>;
  };
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

  it("テンプレートで置き換えたコマは全部 ID 無しで送る", async () => {
    draw([]);

    fireEvent.click(screen.getByRole("button", { name: "テンプレから作成" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "LT会" }));

    const sent = await saveAndCapture();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((i) => i.id === null)).toBe(true);
  });
});

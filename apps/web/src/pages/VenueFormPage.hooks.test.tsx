import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 会場フォームのフックが早期 return より前で揃っていること (#372)。
 *
 * `/venues/:id/edit` を開いた直後は会場の取得が終わっていないので
 * `existing.data` は undefined で、権限なしの早期 return を通らない。
 * 応答が届いて「編集権限なし」と分かった瞬間に早期 return を通るようになる。
 * このとき早期 return より後ろにフックがあると、2回目の描画で呼ぶフックが
 * 減るため React が "Rendered fewer hooks than expected" で落ちる。
 * 読み込み中→権限なしの差し替えを実際に起こして、落ちないことを確かめる。
 */

type VenueQuery = { data: unknown; isLoading: boolean };

let venueQuery: VenueQuery;

const idleMutation = () => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
});

vi.mock("../api/venueHooks.js", () => ({
  useVenue: () => venueQuery,
  useCreateVenue: () => idleMutation(),
  useUpdateVenue: () => idleMutation(),
  useDeleteVenue: () => idleMutation(),
}));
// 会場本体の編集と関係ない部品（自前で API を呼ぶ）は外す
vi.mock("../components/VenueAdminsCard.js", () => ({
  VenueAdminsCard: () => null,
}));

const { VenueFormPage } = await import("./VenueFormPage.js");

/** 取得が終わっていない状態（クエリ実行中） */
const loading: VenueQuery = { data: undefined, isLoading: true };

/** 権限のない利用者に返る応答 */
function withoutPermission(): VenueQuery {
  return {
    isLoading: false,
    data: {
      venue: {
        id: "v-1",
        name: "テスト会場",
        description: "",
        area: "東京",
        address: "",
        addressPublic: false,
        capacity: null,
        equipment: "",
        terms: "",
        contact: "",
        status: "open",
        imageUpdatedAt: null,
      },
      owner: null,
      isOwner: false,
      isManager: false,
    },
  };
}

/** 管理できる利用者に返る応答 */
function withPermission(): VenueQuery {
  const granted = withoutPermission();
  return {
    ...granted,
    data: { ...(granted.data as object), isOwner: true, isManager: true },
  };
}

function draw() {
  return render(
    <MemoryRouter initialEntries={["/venues/v-1/edit"]}>
      <Routes>
        <Route path="/venues/:id/edit" element={<VenueFormPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  venueQuery = loading;
});

describe("会場フォームのフックの順序 (#372)", () => {
  it("読み込み中から権限なしに変わってもフックの数が変わらない", () => {
    const { rerender } = draw();
    // 取得前はフォームが出ている（早期 return を通っていない）
    expect(screen.getByLabelText(/会場名/)).toBeInTheDocument();

    // 応答が届いて「権限なし」と分かる。ここで早期 return を通るようになる
    venueQuery = withoutPermission();
    expect(() =>
      rerender(
        <MemoryRouter initialEntries={["/venues/v-1/edit"]}>
          <Routes>
            <Route path="/venues/:id/edit" element={<VenueFormPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    ).not.toThrow();

    expect(
      screen.getByText("この会場の編集権限がありません。"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/会場名/)).not.toBeInTheDocument();
  });

  it("読み込み中から権限ありに変わると既存値が入ったフォームが出る", () => {
    const { rerender } = draw();
    venueQuery = withPermission();
    rerender(
      <MemoryRouter initialEntries={["/venues/v-1/edit"]}>
        <Routes>
          <Route path="/venues/:id/edit" element={<VenueFormPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/会場名/)).toHaveValue("テスト会場");
  });
});

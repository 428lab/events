import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DutySlot } from "@eventer/shared";
import { deriveSlotBoards } from "../lib/dutyBoard.js";
import { DutyChips } from "./DutyChips.js";

/**
 * 持ち場チップの表示 (#384 設計 9.7)。
 *
 * - 不足（1/2）は warning、充足（2/2）は通常
 * - **外れた担当の名前が出ない**こと。サーバーが `"left"` で user を返さない
 *   （返せない）ので構造上出ないが、「⚠ だけが出る」ことをここで固定する
 */

const DUTIES = [{ id: "d-1", name: "受付", sortOrder: 0 }];

function slotWith(assignees: DutySlot["assignees"], required = 2): DutySlot {
  return { id: "s-1", itemId: "it-1", dutyId: "d-1", requiredCount: required, assignees };
}

function draw(slot: DutySlot, myUserId: string | null = null) {
  render(<DutyChips boards={deriveSlotBoards([slot], DUTIES, myUserId)} />);
}

describe("DutyChips (#384 9.7)", () => {
  it("不足の持ち場は「受付 1/2」で warning 色", () => {
    draw(
      slotWith([
        {
          id: "a-1",
          state: "active",
          user: { id: "u-1", username: "hana", globalName: "はな", avatarUrl: null },
        },
      ]),
    );
    const chip = screen.getByText("受付 1/2");
    expect(chip.closest(".MuiChip-root")).toHaveClass("MuiChip-colorWarning");
  });

  it("充足の持ち場は「受付 2/2」で通常色", () => {
    draw(
      slotWith([
        {
          id: "a-1",
          state: "active",
          user: { id: "u-1", username: "hana", globalName: "はな", avatarUrl: null },
        },
        {
          id: "a-2",
          state: "active",
          user: { id: "u-2", username: "taro", globalName: "たろう", avatarUrl: null },
        },
      ]),
    );
    const chip = screen.getByText("受付 2/2");
    expect(chip.closest(".MuiChip-root")).not.toHaveClass("MuiChip-colorWarning");
  });

  it("外れた担当は充足に数えず ⚠ が付く。名前はどこにも出ない", () => {
    // 「必要2・active 1・left 1」。left を数えると 2/2 に見えてしまう
    draw(
      slotWith([
        {
          id: "a-1",
          state: "active",
          user: { id: "u-1", username: "hana", globalName: "はな", avatarUrl: null },
        },
        { id: "a-2", state: "left", user: null },
      ]),
    );
    expect(screen.getByText("受付 1/2")).toBeInTheDocument();
    expect(screen.getByTitle("外れた担当")).toBeInTheDocument();
    // チップの一覧は人名を出さない（外れた担当の名前は**構造上も出せない**）
    expect(screen.queryByText(/はな/)).toBeNull();
    expect(screen.queryByText(/hana/)).toBeNull();
  });

  it("自分が入っている持ち場は塗られる（要件4「タグが付いて見える」）", () => {
    draw(
      slotWith(
        [
          {
            id: "a-1",
            state: "active",
            user: { id: "me", username: "me", globalName: null, avatarUrl: null },
          },
        ],
        1,
      ),
      "me",
    );
    const chip = screen.getByText("受付 1/1").closest(".MuiChip-root");
    expect(chip).toHaveClass("MuiChip-filled");
  });
});

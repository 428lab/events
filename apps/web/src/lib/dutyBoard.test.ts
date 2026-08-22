import { describe, expect, it } from "vitest";
import type { DutyAssignee, DutySlot, StaffDuty } from "@eventer/shared";
import { countUnfilled, deriveSlotBoards } from "./dutyBoard.js";

/**
 * 充足の導出 (#384 設計 9.7)。
 *
 * 「埋まっているか」は保存されず、ここで毎回導出する（設計 3.7）。
 * いちばん大事な規則は **`"left"` を数えない**こと。数えると
 * 「必要2・割り当て2・うち1人退会」が充足に見え、要件3（埋まっていない
 * 持ち場が分かる）が退会のたびに嘘をつく。
 */

const DUTIES: StaffDuty[] = [
  { id: "d-1", name: "受付", sortOrder: 0 },
  { id: "d-2", name: "配信", sortOrder: 1 },
];

function active(id: string, userId: string): DutyAssignee {
  return {
    id,
    state: "active",
    user: { id: userId, username: `u_${userId}`, globalName: null, avatarUrl: null },
  };
}

/** 外れた担当。**サーバーは user を返さない**（名前も id も。#393 と同じ規則） */
function left(id: string): DutyAssignee {
  return { id, state: "left", user: null };
}

function slot(
  id: string,
  dutyId: string,
  requiredCount: number,
  assignees: DutyAssignee[],
): DutySlot {
  return { id, itemId: "it-1", dutyId, requiredCount, assignees };
}

describe("deriveSlotBoards (#384 9.7)", () => {
  it("割り当て0件の持ち場は不足（必要人数がそのまま不足数）", () => {
    const [b] = deriveSlotBoards([slot("s-1", "d-1", 2, [])], DUTIES, null);
    expect(b).toMatchObject({
      dutyName: "受付",
      activeCount: 0,
      leftCount: 0,
      shortage: 2,
      mine: false,
    });
  });

  it("left は充足に数えない（必要2・割り当て2・うち1人退会 → 不足1）", () => {
    const [b] = deriveSlotBoards(
      [slot("s-1", "d-1", 2, [active("a-1", "u-1"), left("a-2")])],
      DUTIES,
      null,
    );
    expect(b!.activeCount).toBe(1);
    expect(b!.leftCount).toBe(1);
    expect(b!.shortage).toBe(1);
  });

  it("超過（応援）は不足0のまま。activeCount にはそのまま出る", () => {
    const [b] = deriveSlotBoards(
      [
        slot("s-1", "d-1", 2, [
          active("a-1", "u-1"),
          active("a-2", "u-2"),
          active("a-3", "u-3"),
        ]),
      ],
      DUTIES,
      null,
    );
    expect(b!.activeCount).toBe(3);
    expect(b!.shortage).toBe(0);
  });

  it("自分の持ち場は active のときだけ mine（left の自分は数えない）", () => {
    const boards = deriveSlotBoards(
      [
        slot("s-1", "d-1", 1, [active("a-1", "me")]),
        slot("s-2", "d-2", 1, [left("a-2")]),
      ],
      DUTIES,
      "me",
    );
    expect(boards[0]!.mine).toBe(true);
    // left では user が null なので、自分だったとしても mine にならない
    // （名前と同じく「外れた」ことしか分からないのが正しい状態）
    expect(boards[1]!.mine).toBe(false);
  });

  it("countUnfilled は不足のある持ち場だけを数える", () => {
    const boards = deriveSlotBoards(
      [
        slot("s-1", "d-1", 2, [active("a-1", "u-1")]), // 1/2 不足
        slot("s-2", "d-2", 1, [active("a-2", "u-2")]), // 1/1 充足
        slot("s-3", "d-1", 3, []), // 0/3 不足
      ],
      DUTIES,
      null,
    );
    expect(countUnfilled(boards)).toBe(2);
  });
});

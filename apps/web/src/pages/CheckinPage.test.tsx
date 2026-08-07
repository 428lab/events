import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client.js";
import { manualAttendErrorMessage, ResultOverlay } from "./CheckinPage.js";

/**
 * 受付画面で「出席にできなかった」ときの案内 (#286)。
 *
 * 受付は列ができている場で使うので、断られたときに「失敗しました」だけだと
 * その人に何を案内すればよいか分からない。理由が読めることを固定しておく。
 */

const USER = {
  id: "u-1",
  username: "sanka",
  name: "参加太郎",
  avatarUrl: null,
};

describe("受付での出席拒否の案内 (#286)", () => {
  it("確定でない人を手動記録しようとしたら、その理由を出す", () => {
    const message = manualAttendErrorMessage(
      new ApiError(409, { error: "not_confirmed" }),
    );
    expect(message).toBe("参加が確定している人だけ出席にできます");
  });

  it("それ以外の失敗は記録できなかったことだけ伝える", () => {
    expect(manualAttendErrorMessage(new ApiError(500, null))).toBe(
      "出席の記録に失敗しました",
    );
    expect(manualAttendErrorMessage(new Error("offline"))).toBe(
      "出席の記録に失敗しました",
    );
  });

  it("QRを読んだ相手が確定参加者でなければ、その場で分かる表示にする", () => {
    render(
      <ResultOverlay
        panel={{ kind: "not_confirmed", user: USER }}
        onManualAttend={() => {}}
        onCancelManual={() => {}}
      />,
    );

    expect(
      screen.getByText("このイベントの確定参加者ではありません"),
    ).toBeInTheDocument();
    // 誰のことか分からないと受付で声をかけられない
    expect(screen.getByText("参加太郎")).toBeInTheDocument();
  });

  it("プロフィールQRの手動記録には本人確認の注意を出す", () => {
    render(
      <ResultOverlay
        panel={{ kind: "manual", user: USER }}
        onManualAttend={() => {}}
        onCancelManual={() => {}}
      />,
    );

    expect(
      screen.getByText(/本人確認チケットではありません/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "手動で出席にする" }),
    ).toBeInTheDocument();
  });
});

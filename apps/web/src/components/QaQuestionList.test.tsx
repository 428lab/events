import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { EventQuestion } from "@eventer/shared";
import { QaPickedQuestion, QaQuestionList } from "./QaQuestionList.js";

/**
 * Q&A の表示部品 (#216) のうち、**人に見せる画面に出てはいけないもの**の退行防止 (#215)。
 *
 * 匿名投稿の author はイベントのスタッフにだけサーバーから届く。投影用画面や
 * 登壇者サイドパネルはスタッフのアカウントで開くので、既定で出てしまうと
 * 匿名で聞いた人の実名が会場のスクリーンに映る。既定は「出さない」であること、
 * 明示したときだけ出ることを、実際に描画して確かめる。
 */

const AUTHOR = {
  id: "u-1",
  username: "asker",
  name: "質問した人",
  avatarUrl: null,
};

function question(patch: Partial<EventQuestion> = {}): EventQuestion {
  return {
    id: "q-1",
    eventId: "e-1",
    body: "匿名で聞きたいこと",
    createdAt: 1_700_000_000_000,
    anonymous: true,
    answered: false,
    hidden: false,
    votes: 3,
    votedByMe: false,
    mine: false,
    // スタッフのアカウントで開いた状態＝サーバーから author が届いている
    author: AUTHOR,
    ...patch,
  };
}

function draw(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("QaQuestionList の匿名投稿", () => {
  it("revealAuthor を渡さないと、匿名投稿の投稿者名は DOM に出ない", () => {
    draw(<QaQuestionList questions={[question()]} />);

    expect(screen.getByText("匿名で聞きたいこと")).toBeInTheDocument();
    expect(screen.getByText("匿名")).toBeInTheDocument();
    expect(screen.queryByText(/質問した人/)).not.toBeInTheDocument();
  });

  it("revealAuthor を渡したときだけ投稿者名が出る（対になる確認）", () => {
    draw(<QaQuestionList questions={[question()]} revealAuthor />);

    expect(screen.getByText(/質問した人/)).toBeInTheDocument();
  });

  it("実名投稿の投稿者名は revealAuthor に関わらず出る", () => {
    draw(
      <QaQuestionList
        questions={[question({ anonymous: false, body: "実名で聞くこと" })]}
      />,
    );

    expect(screen.getByText("質問した人")).toBeInTheDocument();
  });

  it("showMineChip=false なら「自分」チップを出さない（画面共有で本人だと分かるため）", () => {
    const mine = [question({ mine: true })];
    const { unmount } = draw(<QaQuestionList questions={mine} />);
    expect(screen.getByText("自分")).toBeInTheDocument();
    unmount();

    draw(<QaQuestionList questions={mine} showMineChip={false} />);
    expect(screen.queryByText("自分")).not.toBeInTheDocument();
  });
});

describe("QaPickedQuestion（投影用に大きく出す1件）", () => {
  it("revealAuthor を渡さないと、匿名投稿の投稿者名は DOM に出ない", () => {
    draw(<QaPickedQuestion question={question()} />);

    expect(screen.getByText("匿名で聞きたいこと")).toBeInTheDocument();
    expect(screen.getByText("匿名")).toBeInTheDocument();
    expect(screen.queryByText(/質問した人/)).not.toBeInTheDocument();
  });

  it("revealAuthor を渡したときだけ投稿者名が出る（対になる確認）", () => {
    draw(<QaPickedQuestion question={question()} revealAuthor />);

    expect(screen.getByText("匿名（質問した人）")).toBeInTheDocument();
  });

  it("onClear を渡さなければ解除ボタンは出ない（投影に操作UIを出さない）", () => {
    draw(<QaPickedQuestion question={question()} />);

    expect(
      screen.queryByRole("button", { name: "ピックアップを解除" }),
    ).not.toBeInTheDocument();
  });
});

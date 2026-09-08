import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, CardContent } from "@mui/material";
import { EventDetailSidebar } from "./EventDetailSidebar.js";

// jsdomでは実レイアウトは測れないため、実際のMUI Cardに適用される
// 縮小禁止の契約を確認する。スクロール到達性はブラウザで別途検証する。
describe("EventDetailSidebar (#497)", () => {
  it.each([false, true])("招待カード有無=%s: 参加者カードを縮めない", (invites) => {
    render(
      <EventDetailSidebar>
        {invites && (
          <Card data-testid="invites">
            <CardContent>運営招待</CardContent>
          </Card>
        )}
        <Card data-testid="members">
          <CardContent>
            {Array.from({ length: 30 }, (_, i) => (
              <div key={i}>参加者 {i + 1}</div>
            ))}
            <button>最後の参加者の操作</button>
          </CardContent>
        </Card>
      </EventDetailSidebar>,
    );
    expect(getComputedStyle(screen.getByTestId("members")).flexShrink).toBe("0");
    if (invites) {
      expect(getComputedStyle(screen.getByTestId("invites")).flexShrink).toBe("0");
    }
    expect(screen.getByRole("button", { name: "最後の参加者の操作" })).toBeTruthy();
  });
});

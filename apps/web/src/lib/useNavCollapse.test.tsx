import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useNavCollapse } from "./useNavCollapse.js";

/**
 * ヘッダーのナビが収まらなくなったら畳む判定 (#316)。
 * jsdom はレイアウトを持たないので、幅は data 属性から返すように差し替えて測る。
 */
const orig = {
  clientWidth: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  ),
  scrollWidth: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollWidth",
  ),
};

function stubWidths() {
  for (const prop of ["clientWidth", "scrollWidth"] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return Number(this.dataset.w ?? 0);
      },
    });
  }
}

beforeAll(stubWidths);
afterAll(() => {
  for (const prop of ["clientWidth", "scrollWidth"] as const) {
    if (orig[prop]) Object.defineProperty(HTMLElement.prototype, prop, orig[prop]);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
});

function Harness({ available, needed }: { available: number; needed: number }) {
  const { containerRef, contentRef, collapsed } = useNavCollapse<
    HTMLDivElement,
    HTMLDivElement
  >();
  return (
    <div>
      <div ref={containerRef} data-w={available} />
      <div ref={contentRef} data-w={needed} />
      <span data-testid="state">{collapsed ? "collapsed" : "expanded"}</span>
    </div>
  );
}

const state = () => screen.getByTestId("state").textContent;

describe("useNavCollapse", () => {
  it("収まっている間は横並びのまま", () => {
    render(<Harness available={500} needed={400} />);
    expect(state()).toBe("expanded");
  });

  it("必要幅が使える幅を超えたら畳む", () => {
    render(<Harness available={300} needed={400} />);
    expect(state()).toBe("collapsed");
  });

  it("ぴったり収まる幅では畳まない", () => {
    render(<Harness available={400} needed={400} />);
    expect(state()).toBe("expanded");
  });

  it("幅が変わったら測り直す（狭める→畳む、広げる→戻る）", () => {
    const { rerender } = render(<Harness available={500} needed={400} />);
    expect(state()).toBe("expanded");

    rerender(<Harness available={300} needed={400} />);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(state()).toBe("collapsed");

    rerender(<Harness available={500} needed={400} />);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(state()).toBe("expanded");
  });

  it("幅を測れない環境では横並びのまま（判定を諦める）", () => {
    render(<Harness available={0} needed={0} />);
    expect(state()).toBe("expanded");
  });
});

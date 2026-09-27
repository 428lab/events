import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LiveEventChat } from "./LiveEventChat.js";
import { LiveSceneStage } from "./LiveStage.js";
import type { LiveElement } from "@eventer/shared";

const element: LiveElement = { id: "comments", type: "chat", x: 10, y: 10, w: 380, h: 190, rotation: 0, chatStyle: "hakuji", chatRows: 2, chatSeconds: 20 };
describe("LiveEventChat", () => {
  it("renders in the production stage and never inserts editor preview into live output", () => {
    const scene = { id: "stage", name: "stage", background: "#0E1426", elements: [element] };
    const view = render(<LiveSceneStage scene={scene} width={720} runtime={{ chatRows: [] }} />);
    expect(view.container.textContent).toBe("");
    view.rerender(<LiveSceneStage scene={scene} width={1080} runtime={{ chatRows: [{ source: "event", id: "posted", authoredAtMs: Date.now(), name: "投稿者", avatar: null, plainText: "配信コメント" }] }} />);
    expect(screen.getByText("配信コメント")).toBeTruthy();
    expect(screen.getByText("events lab")).toBeTruthy();
    view.rerender(<LiveSceneStage scene={scene} width={720} runtime={{ chatRows: [] }} />);
    expect(view.container.textContent).toBe("");
  });
  it("renders a real allowed author's name, same-origin photo and separate source at stage size", () => {
    const view = render(<LiveEventChat el={element} rows={[{ source: "event", id: "posted", authoredAtMs: Date.now(), name: "長い投稿者の名前", avatar: "/api/users/u1/avatar?v=1", plainText: "実際の投稿" }]} light />);
    expect(screen.getByText("長い投稿者の名前")).toBeTruthy();
    expect(screen.getByText("events lab")).toBeTruthy();
    expect(screen.getByText("実際の投稿")).toBeTruthy();
    const img = view.container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/api/users/u1/avatar?v=1");
    const icon = img.parentElement!;
    expect(icon.style.width).toBe("34px");
    expect(icon.style.height).toBe("34px");
    expect(icon.style.position).toBe("relative");
    expect(icon.style.color).toBe("rgb(255, 255, 255)");
    expect(img.style.position).toBe("absolute");
    expect(img.style.inset).toBe("0");
    expect(img.style.objectFit).toBe("cover");
    expect(icon.textContent).toBe("長");
    fireEvent.error(img);
    expect(img.style.display).toBe("none");
    expect(icon.textContent).toBe("長");
    view.rerender(<LiveEventChat el={element} rows={[]} light />);
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.textContent).toBe("");
  });
});

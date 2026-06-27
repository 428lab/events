import { DECK_H, DECK_W } from "@eventer/shared";
import type { DeckElement, DeckSlide } from "@eventer/shared";

/** 要素の中身（テキスト/画像）。位置・サイズは親が持つ */
export function ElementContent({ el }: { el: DeckElement }) {
  if (el.type === "image") {
    return el.src ? (
      <img
        src={el.src}
        alt=""
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          pointerEvents: "none",
          userSelect: "none",
        }}
      />
    ) : (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "grid",
          placeItems: "center",
          background: "#e5e7eb",
          color: "#6b7280",
          fontSize: 18,
        }}
      >
        画像URL未設定
      </div>
    );
  }
  const justify =
    el.align === "center"
      ? "center"
      : el.align === "right"
        ? "flex-end"
        : "flex-start";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: justify,
        textAlign: el.align ?? "left",
        color: el.color ?? "#0f172a",
        fontSize: el.fontSize ?? 28,
        fontWeight: el.bold ? 700 : 400,
        fontStyle: el.italic ? "italic" : "normal",
        lineHeight: 1.3,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflow: "hidden",
      }}
    >
      {el.text ?? ""}
    </div>
  );
}

/** スライドを指定幅で読み取り専用描画（ビューア・サムネ用） */
export function SlideStage({
  slide,
  width,
}: {
  slide: DeckSlide;
  width: number;
}) {
  const scale = width / DECK_W;
  return (
    <div
      style={{
        width,
        height: DECK_H * scale,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: DECK_W,
          height: DECK_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          background: slide.background ?? "#ffffff",
        }}
      >
        {slide.elements.map((el) => (
          <div
            key={el.id}
            style={{
              position: "absolute",
              left: el.x,
              top: el.y,
              width: el.w,
              height: el.h,
              transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
            }}
          >
            <ElementContent el={el} />
          </div>
        ))}
      </div>
    </div>
  );
}

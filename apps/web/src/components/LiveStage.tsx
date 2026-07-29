import type { ReactNode } from "react";
import ImageIcon from "@mui/icons-material/Image";
import MonitorIcon from "@mui/icons-material/Monitor";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import { LIVE_H, LIVE_W } from "@eventer/shared";
import type { EventInfoField, LiveElement, LiveScene } from "@eventer/shared";

/** 配信画面タブが実体（カメラ映像・デッキスライド・イベント情報）を差し込むための口。
 * 未指定（エディタ・サムネイル）はプレースホルダー表示になる */
export interface LiveRuntime {
  /** camera 要素の中身（<video> 等） */
  camera?: (el: LiveElement) => ReactNode;
  /** deck 要素の中身（現在ページのスライド描画） */
  deck?: (el: LiveElement) => ReactNode;
  /** eventInfo のフィールド値 */
  eventInfo?: (field: EventInfoField) => string;
}

const PLACEHOLDER_INFO: Record<EventInfoField, string> = {
  title: "イベントタイトル",
  datetime: "2026/1/1 19:00 〜 21:00",
  participants: "参加 12 人",
  community: "コミュニティ名",
};

function Placeholder({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        placeItems: "center",
        background: "rgba(148,163,184,0.15)",
        border: "1px dashed rgba(148,163,184,0.6)",
        color: "#94a3b8",
        fontSize: 20,
        boxSizing: "border-box",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ lineHeight: 1.2 }}>{icon}</div>
        {label}
      </div>
    </div>
  );
}

function textStyle(el: LiveElement): React.CSSProperties {
  const justify =
    el.align === "center"
      ? "center"
      : el.align === "right"
        ? "flex-end"
        : "flex-start";
  return {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: justify,
    textAlign: el.align ?? "left",
    color: el.color ?? "#EAF0F7",
    fontFamily: el.fontFamily || undefined,
    fontSize: el.fontSize ?? 28,
    fontWeight: el.bold ? 700 : 400,
    fontStyle: el.italic ? "italic" : "normal",
    lineHeight: 1.3,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflow: "hidden",
  };
}

/** 配信シーン要素の中身。位置・サイズは親が持つ */
export function LiveElementContent({
  el,
  runtime,
}: {
  el: LiveElement;
  runtime?: LiveRuntime;
}) {
  switch (el.type) {
    case "image":
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
        <Placeholder label="画像未設定" icon={<ImageIcon sx={{ fontSize: 36 }} />} />
      );
    case "camera": {
      const inner = runtime?.camera?.(el);
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            overflow: "hidden",
            borderRadius: el.radius ?? 0,
          }}
        >
          {inner ?? (
            <Placeholder label="カメラ" icon={<PhotoCameraIcon sx={{ fontSize: 36 }} />} />
          )}
        </div>
      );
    }
    case "deck":
      return (
        runtime?.deck?.(el) ?? (
          <Placeholder label="スライド" icon={<MonitorIcon sx={{ fontSize: 36 }} />} />
        )
      );
    case "eventInfo": {
      const field = el.field ?? "title";
      const value = runtime?.eventInfo?.(field) ?? PLACEHOLDER_INFO[field];
      return <div style={textStyle(el)}>{value}</div>;
    }
    default:
      return <div style={textStyle(el)}>{el.text ?? ""}</div>;
  }
}

/** シーンを指定幅で読み取り専用描画（サムネイル・配信画面用） */
export function LiveSceneStage({
  scene,
  width,
  runtime,
}: {
  scene: LiveScene;
  width: number;
  runtime?: LiveRuntime;
}) {
  const scale = width / LIVE_W;
  return (
    <div
      style={{
        width,
        height: LIVE_H * scale,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: LIVE_W,
          height: LIVE_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          background: scene.background || "#0E1426",
        }}
      >
        {scene.elements.map((el) => (
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
            <LiveElementContent el={el} runtime={runtime} />
          </div>
        ))}
      </div>
    </div>
  );
}

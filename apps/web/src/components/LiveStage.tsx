import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
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

/** 実体が差し込まれないとき（エディタ・サムネイル）に出す見本。
 * **訳した文字列ではなくキーを持つ**ので、言語を切り替えたときに
 * 前の言語のまま残らない (#367) */
const PLACEHOLDER_INFO_KEY = {
  title: "studio.infoFieldTitle",
  datetime: "studio.infoSampleDatetime",
  /** 人数の並べ方は共通の文言を引く（差し込みが要るのはこれだけ） */
  participants: "common.participants",
  community: "studio.infoFieldCommunity",
} as const satisfies Record<EventInfoField, string>;

/** 見本に出す参加人数 */
const PLACEHOLDER_PARTICIPANTS = 12;

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
  const { t } = useTranslation();
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
        <Placeholder
          label={t("studio.imageUnset")}
          icon={<ImageIcon sx={{ fontSize: 36 }} />}
        />
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
            <Placeholder
              label={t("studio.elementCamera")}
              icon={<PhotoCameraIcon sx={{ fontSize: 36 }} />}
            />
          )}
        </div>
      );
    }
    case "deck":
      return (
        runtime?.deck?.(el) ?? (
          <Placeholder
            label={t("studio.elementDeck")}
            icon={<MonitorIcon sx={{ fontSize: 36 }} />}
          />
        )
      );
    case "eventInfo": {
      const field = el.field ?? "title";
      const value =
        runtime?.eventInfo?.(field) ??
        t(PLACEHOLDER_INFO_KEY[field], { n: PLACEHOLDER_PARTICIPANTS });
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

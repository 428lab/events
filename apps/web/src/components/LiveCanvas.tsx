import { useState } from "react";
import { Box } from "@mui/material";
import { Rnd } from "react-rnd";
import { LIVE_H, LIVE_W } from "@eventer/shared";
import type { LiveElement, LiveScene } from "@eventer/shared";
import type { LiveElementCommands } from "../lib/liveScenes.js";
import { useCanvasScale } from "../lib/editor/useCanvasScale.js";
import { LiveElementContent } from "./LiveStage.js";
import { ResizeHandles } from "./ResizeHandles.js";

/**
 * 配信セットの編集キャンバス。要素を掴んで動かす所。
 *
 * 動かしている最中は content を触らず、ここが持つ一時的なずれだけを更新する。
 * 一手ごとに content を書き換えると、履歴に細切れの段が積まれるうえ、
 * 位置を渡し直された react-rnd と実際のドラッグ位置がぶつかって震える。
 * 確定するのは指を離した時の1回だけ。
 *
 * スライド編集の DeckCanvas と**1つにはしていない**。あちらは複数選択と
 * グループでまとめて動かす仕掛けを持つが、配信セットの選択は常に1つ。
 * 1つにすると使わない分岐を持ち込むことになる。同じなのは倍率の出し方・
 * 変形ハンドル・ドラッグの確定の作法で、そこは lib/editor/ 側に置いてある。
 */
export function LiveCanvas({
  scene,
  selected,
  commands,
  onSelect,
  onSelectNone,
}: {
  /** 編集中のシーン。1つも無い状態では undefined */
  scene: LiveScene | undefined;
  /** 選んでいる要素。今のシーンに無ければ null */
  selected: LiveElement | null;
  commands: LiveElementCommands;
  onSelect: (elId: string) => void;
  onSelectNone: () => void;
}) {
  const { ref, width, scale } = useCanvasScale(LIVE_W);
  /** 動かしている間の位置。変形ハンドルを追従させるために持つ */
  const [dragXY, setDragXY] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);

  return (
    <Box
      ref={ref}
      // 要素を選ぶ手段がここしか無いので、テストから範囲を絞れるようにしておく
      // （同じ文字はシーン一覧のサムネイルにも出る）
      data-testid="live-canvas"
      sx={{
        width: "100%",
        // 全幅でも縦が画面を超えないよう高さで上限（16:9）
        maxWidth: "calc(80vh * 16 / 9)",
      }}
    >
      {scene && scale > 0 && (
        <Box
          onMouseDown={onSelectNone}
          sx={{
            position: "relative",
            width,
            height: LIVE_H * scale,
            bgcolor: "grey.300",
            overflow: "hidden",
            borderRadius: 1,
          }}
        >
          <Box
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              width: LIVE_W,
              height: LIVE_H,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              background: scene.background,
            }}
          >
            {scene.elements.map((el) => (
              <Rnd
                key={el.id}
                scale={scale}
                bounds="parent"
                size={{ width: el.w, height: el.h }}
                position={{ x: el.x, y: el.y }}
                // 変形は四隅の自前ハンドルで行う（指でも掴める大きさにするため）
                enableResizing={false}
                onDrag={(_e, d) => setDragXY({ id: el.id, x: d.x, y: d.y })}
                onDragStop={(_e, d) => {
                  if (d.x !== el.x || d.y !== el.y) {
                    commands.moveTo(el.id, d.x, d.y);
                  }
                  setDragXY(null);
                }}
                onMouseDown={(e: MouseEvent) => {
                  // 背景の「選択解除」に届かせない
                  e.stopPropagation();
                  onSelect(el.id);
                }}
                style={{
                  outline:
                    selected?.id === el.id
                      ? "2px solid #2563eb"
                      : "1px dashed rgba(148,163,184,0.4)",
                  touchAction: "none",
                }}
              >
                <LiveElementContent el={el} />
              </Rnd>
            ))}

            {selected && (
              <ResizeHandles
                rect={{
                  x: selected.x,
                  y: selected.y,
                  w: selected.w,
                  h: selected.h,
                }}
                displayXY={
                  dragXY?.id === selected.id ? dragXY : undefined
                }
                scale={scale}
                onResize={(rect) => commands.patch(selected.id, rect)}
              />
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

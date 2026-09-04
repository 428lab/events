import { useRef, useState } from "react";
import { Box } from "@mui/material";
import { Rnd } from "react-rnd";
import { DECK_H, DECK_W } from "@eventer/shared";
import type { DeckSlide } from "@eventer/shared";
import { expandGroup } from "../lib/deckSlides.js";
import type { DeckElementCommands, DeckSelection } from "../lib/deckSlides.js";
import { useCanvasScale } from "../lib/editor/useCanvasScale.js";
import { ElementContent } from "./SlideStage.js";
import { ResizeHandles } from "./ResizeHandles.js";

/**
 * 編集キャンバス。要素を掴んで動かす所。
 *
 * 動かしている最中は content を触らず、ここが持つ一時的なずれだけを更新する。
 * 一手ごとに content を書き換えると、履歴に細切れの段が積まれるうえ、
 * 位置を渡し直された react-rnd と実際のドラッグ位置がぶつかって震える。
 * 確定するのは指を離した時の1回だけ。
 */
export function DeckCanvas({
  slide,
  selection,
  multiSelect,
  commands,
  onSelect,
  onSelectOnly,
  onSelectNone,
}: {
  /** 編集中のページ。ページが1枚も無い状態では undefined */
  slide: DeckSlide | undefined;
  selection: DeckSelection;
  multiSelect: boolean;
  commands: DeckElementCommands;
  /** 掴んだ要素を選ぶ。グループの一員なら相方も一緒に選ばれる */
  onSelect: (elId: string, additive: boolean) => void;
  /** その要素だけを選ぶ。変形はグループ単位ではなく1つずつなので広げない */
  onSelectOnly: (elId: string) => void;
  onSelectNone: () => void;
}) {
  const { ref, width, scale } = useCanvasScale(DECK_W);
  /** 1つだけ動かしている間の位置。変形ハンドルを追従させるために持つ */
  const [dragXY, setDragXY] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  /** まとめて動かしている間のずれ。掴んだ要素以外はこれを足した位置に描く */
  const [groupOffset, setGroupOffset] = useState<{
    ids: string[];
    draggedId: string;
    dx: number;
    dy: number;
  } | null>(null);
  /** ドラッグ開始時の位置。確定時にここからの差分で反映する */
  const dragStart = useRef<{
    draggedId: string;
    ids: string[];
    starts: Record<string, { x: number; y: number }>;
  } | null>(null);

  const els = slide?.elements ?? [];
  const selectedSet = new Set(selection.ids);
  const one = selection.one;

  /** 掴んだ要素と一緒に動くもの。選択中のものを掴んだなら選択ごと、でなければグループごと */
  const dragTargets = (elId: string) =>
    selectedSet.has(elId) ? selection.ids : expandGroup(els, elId);

  return (
    <Box
      ref={ref}
      sx={{
        width: "100%",
        // 全幅でも縦が画面を超えないよう高さで上限（16:9）
        maxWidth: "calc(80vh * 16 / 9)",
      }}
    >
        {slide && scale > 0 && (
          <Box
            onMouseDown={onSelectNone}
            sx={{
              position: "relative",
              width,
              height: DECK_H * scale,
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
                width: DECK_W,
                height: DECK_H,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                background: slide.background,
              }}
            >
              {slide.elements.map((el) => {
                const followsGroup =
                  groupOffset !== null &&
                  groupOffset.ids.includes(el.id) &&
                  el.id !== groupOffset.draggedId;
                return (
                  <Rnd
                    key={el.id}
                    scale={scale}
                    bounds="parent"
                    size={{ width: el.w, height: el.h }}
                    position={{
                      x: followsGroup ? el.x + groupOffset.dx : el.x,
                      y: followsGroup ? el.y + groupOffset.dy : el.y,
                    }}
                    // 変形は四隅の自前ハンドルで行う（指でも掴める大きさにするため）
                    enableResizing={false}
                    onDragStart={() => {
                      // 選択は onMouseDown 側で確定済み。ここでは上書きしない
                      const ids = dragTargets(el.id);
                      const starts: Record<string, { x: number; y: number }> =
                        {};
                      els.forEach((e) => {
                        if (ids.includes(e.id)) starts[e.id] = { x: e.x, y: e.y };
                      });
                      dragStart.current = { draggedId: el.id, ids, starts };
                      if (ids.length > 1)
                        setGroupOffset({
                          ids,
                          draggedId: el.id,
                          dx: 0,
                          dy: 0,
                        });
                    }}
                    onDrag={(_e, d) => {
                      const g = dragStart.current;
                      if (g && g.ids.length > 1) {
                        const base = g.starts[g.draggedId];
                        setGroupOffset({
                          ids: g.ids,
                          draggedId: g.draggedId,
                          dx: d.x - base.x,
                          dy: d.y - base.y,
                        });
                      } else {
                        setDragXY({ id: el.id, x: d.x, y: d.y });
                      }
                    }}
                    onDragStop={(_e, d) => {
                      const g = dragStart.current;
                      if (g && g.ids.length > 1) {
                        const base = g.starts[g.draggedId];
                        const dx = d.x - base.x;
                        const dy = d.y - base.y;
                        if (dx !== 0 || dy !== 0) {
                          commands.moveTo(
                            Object.entries(g.starts).map(([id, s]) => ({
                              id,
                              x: s.x + dx,
                              y: s.y + dy,
                            })),
                          );
                        }
                      } else if (d.x !== el.x || d.y !== el.y) {
                        commands.moveTo([{ id: el.id, x: d.x, y: d.y }]);
                      }
                      setDragXY(null);
                      setGroupOffset(null);
                      dragStart.current = null;
                    }}
                    onMouseDown={(e: MouseEvent) => {
                      // 背景の「選択解除」に届かせない
                      e.stopPropagation();
                      const additive = e.shiftKey || multiSelect;
                      if (additive) onSelect(el.id, true);
                      // すでに選択に入っているものは掴み直しても選択を崩さない
                      // （まとめて動かす途中で選択が1つに減らないように）
                      else if (!selectedSet.has(el.id)) onSelect(el.id, false);
                    }}
                    style={{
                      outline: selectedSet.has(el.id)
                        ? "2px solid #2563eb"
                        : "1px dashed rgba(0,0,0,0.25)",
                      touchAction: "none",
                    }}
                  >
                    <ElementContent el={el} />
                  </Rnd>
                );
              })}

              {/* 変形ハンドルは1つだけ選んでいるときに出す */}
              {one && (
                <ResizeHandles
                  rect={{ x: one.x, y: one.y, w: one.w, h: one.h }}
                  displayXY={dragXY?.id === one.id ? dragXY : undefined}
                  scale={scale}
                  onStart={() => onSelectOnly(one.id)}
                  onResize={(rect) => commands.patch(one.id, rect)}
                />
              )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

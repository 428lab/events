import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Box,
  Button,
  Divider,
  IconButton,
  MenuItem,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import ImageIcon from "@mui/icons-material/Image";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import { Link as RouterLink, useParams } from "react-router-dom";
import { Rnd } from "react-rnd";
import { DECK_H, DECK_W } from "@eventer/shared";
import type { DeckContent, DeckElement, DeckSlide } from "@eventer/shared";
import {
  useDeck,
  useUpdateDeck,
  useUploadDeckImage,
} from "../api/deckHooks.js";
import { ElementContent } from "../components/SlideStage.js";
import { DECK_FONTS, ensureDeckFont, ensureDeckFonts } from "../lib/deckFonts.js";
import { encodeImageForUpload } from "../lib/encodeImage.js";

const uid = () => crypto.randomUUID();

export function DeckEditorPage() {
  const { id = "" } = useParams();
  const { data: deck, isLoading, isError } = useDeck(id);
  const update = useUpdateDeck(id);
  const upload = useUploadDeckImage(id);
  const fileRef = useRef<HTMLInputElement>(null);
  const onPicked = useRef<(url: string) => void>(() => {});
  // 自前リサイズの進行中ジェスチャ（フックは早期returnより前に置く）
  const resizeRef = useRef<{
    elId: string;
    corner: string;
    sx: number;
    sy: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState<DeckContent | null>(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // ドラッグ中のハンドル追従用（content は触らずここだけ更新してループを防ぐ）
  const [dragXY, setDragXY] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const inited = useRef(false);

  // 履歴（Undo/Redo）。content の変更を少し待って1ステップにまとめて積む
  const undoStack = useRef<DeckContent[]>([]);
  const redoStack = useRef<DeckContent[]>([]);
  const lastCommitted = useRef<DeckContent | null>(null);
  const histTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [histVer, setHistVer] = useState(0);

  useEffect(() => {
    if (deck && !inited.current) {
      setTitle(deck.title);
      setContent(deck.content);
      lastCommitted.current = deck.content;
      ensureDeckFonts(deck.content);
      inited.current = true;
    }
  }, [deck]);

  // content 変更を 500ms 後に履歴へコミット（連続変更は1ステップに集約）
  useEffect(() => {
    if (content === null || lastCommitted.current === null) return;
    if (content === lastCommitted.current) return;
    if (histTimer.current) clearTimeout(histTimer.current);
    histTimer.current = setTimeout(() => {
      undoStack.current.push(lastCommitted.current!);
      if (undoStack.current.length > 100) undoStack.current.shift();
      lastCommitted.current = content;
      redoStack.current = [];
      setHistVer((v) => v + 1);
    }, 500);
  }, [content]);

  // 自動保存（変更の 800ms 後）
  const firstSave = useRef(true);
  useEffect(() => {
    if (content === null) return;
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    const t = setTimeout(() => update.mutate({ title, content }), 800);
    return () => clearTimeout(t);
  }, [content, title]);

  // 最新の undo/redo を保持（キーボードハンドラから呼ぶ）
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return; // 文字入力中はブラウザ標準
      e.preventDefault();
      if (k === "y" || (k === "z" && e.shiftKey)) redoRef.current();
      else undoRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // キャンバス幅の計測
  const canvasRef = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(0);
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth));
    ro.observe(el);
    setCw(el.clientWidth);
    return () => ro.disconnect();
  }, [content]);

  if (isError) return <Typography>スライドが見つかりません。</Typography>;
  if (isLoading || !content) return <Typography>読み込み中…</Typography>;

  const slides = content.slides;
  const idx = Math.min(slideIdx, slides.length - 1);
  const slide: DeckSlide | undefined = slides[idx];
  const scale = cw > 0 ? cw / DECK_W : 0;
  const selected = slide?.elements.find((e) => e.id === selectedId) ?? null;

  // 自前リサイズ用ハンドル（キャンバスは scale 倍。画面上で約24pxに見えるよう逆補正）
  const hs = Math.max(12, Math.round(24 / (scale || 1)));
  const hb = Math.max(1, Math.round(2 / (scale || 1)));

  // 履歴の保留分を即コミット（Undo/Redo 前に呼ぶ）
  const flushHistory = () => {
    if (histTimer.current) {
      clearTimeout(histTimer.current);
      histTimer.current = null;
    }
    if (lastCommitted.current && content !== lastCommitted.current) {
      undoStack.current.push(lastCommitted.current);
      lastCommitted.current = content;
      redoStack.current = [];
    }
  };
  const undo = () => {
    flushHistory();
    const prev = undoStack.current.pop();
    if (prev === undefined || lastCommitted.current === null) return;
    redoStack.current.push(lastCommitted.current);
    lastCommitted.current = prev;
    setContent(prev);
    setSelectedId(null);
    setHistVer((v) => v + 1);
  };
  const redo = () => {
    flushHistory();
    const next = redoStack.current.pop();
    if (next === undefined || lastCommitted.current === null) return;
    undoStack.current.push(lastCommitted.current);
    lastCommitted.current = next;
    setContent(next);
    setSelectedId(null);
    setHistVer((v) => v + 1);
  };
  undoRef.current = undo;
  redoRef.current = redo;
  void histVer;
  const canUndo =
    undoStack.current.length > 0 ||
    (lastCommitted.current !== null && content !== lastCommitted.current);
  const canRedo = redoStack.current.length > 0;

  const setSlides = (fn: (s: DeckSlide[]) => DeckSlide[]) =>
    setContent((c) => (c ? { ...c, slides: fn(c.slides) } : c));
  const patchSlide = (i: number, patch: Partial<DeckSlide>) =>
    setSlides((s) => s.map((sl, j) => (j === i ? { ...sl, ...patch } : sl)));
  const patchElement = (elId: string, patch: Partial<DeckElement>) =>
    setSlides((s) =>
      s.map((sl, j) =>
        j === idx
          ? {
              ...sl,
              elements: sl.elements.map((e) =>
                e.id === elId ? { ...e, ...patch } : e,
              ),
            }
          : sl,
      ),
    );
  const addElement = (el: DeckElement) => {
    setSlides((s) =>
      s.map((sl, j) =>
        j === idx ? { ...sl, elements: [...sl.elements, el] } : sl,
      ),
    );
    setSelectedId(el.id);
  };
  const deleteElement = (elId: string) => {
    // 削除ボタンがフォーカスのまま消えるとブラウザがトップへスクロールするため抑止
    (document.activeElement as HTMLElement | null)?.blur?.();
    const y = window.scrollY;
    setSlides((s) =>
      s.map((sl, j) =>
        j === idx
          ? { ...sl, elements: sl.elements.filter((e) => e.id !== elId) }
          : sl,
      ),
    );
    setSelectedId(null);
    requestAnimationFrame(() => window.scrollTo(0, y));
  };

  // 自前リサイズ（マウス/タッチ統一の Pointer Events）
  const startResize = (
    e: React.PointerEvent,
    el: DeckElement,
    corner: string,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelectedId(el.id);
    resizeRef.current = {
      elId: el.id,
      corner,
      sx: e.clientX,
      sy: e.clientY,
      x: el.x,
      y: el.y,
      w: el.w,
      h: el.h,
    };
  };
  const moveResize = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    const s = scale || 1;
    const dx = (e.clientX - r.sx) / s;
    const dy = (e.clientY - r.sy) / s;
    let { x, y, w, h } = r;
    if (r.corner.includes("e")) w = r.w + dx;
    if (r.corner.includes("w")) w = r.w - dx;
    w = Math.max(20, w);
    if (r.corner.includes("w")) x = r.x + (r.w - w);
    if (r.corner.includes("s")) h = r.h + dy;
    if (r.corner.includes("n")) h = r.h - dy;
    h = Math.max(20, h);
    if (r.corner.includes("n")) y = r.y + (r.h - h);
    patchElement(r.elId, { x, y, w, h });
  };
  const endResize = () => {
    resizeRef.current = null;
  };

  const addText = () =>
    addElement({
      id: uid(),
      type: "text",
      x: 120,
      y: 200,
      w: 480,
      h: 100,
      rotation: 0,
      text: "テキスト",
      fontSize: 40,
      color: "#0f172a",
      align: "left",
    });
  const pickImage = (cb: (url: string) => void) => {
    onPicked.current = cb;
    fileRef.current?.click();
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const encoded = await encodeImageForUpload(file);
      const { url } = await upload.mutateAsync(encoded);
      onPicked.current(url);
    } catch {
      window.alert("画像のアップロードに失敗しました（6MBまで）");
    }
  };
  const addImage = () =>
    pickImage((url) =>
      addElement({
        id: uid(),
        type: "image",
        x: 200,
        y: 120,
        w: 400,
        h: 300,
        rotation: 0,
        src: url,
      }),
    );

  const addSlide = () => {
    const ns: DeckSlide = { id: uid(), background: "#ffffff", elements: [] };
    setSlides((s) => [...s.slice(0, idx + 1), ns, ...s.slice(idx + 1)]);
    setSlideIdx(idx + 1);
    setSelectedId(null);
  };
  const dupSlide = () => {
    const copy: DeckSlide = {
      ...slide!,
      id: uid(),
      elements: slide!.elements.map((e) => ({ ...e, id: uid() })),
    };
    setSlides((s) => [...s.slice(0, idx + 1), copy, ...s.slice(idx + 1)]);
    setSlideIdx(idx + 1);
  };
  const delSlide = () => {
    if (slides.length <= 1) return;
    setSlides((s) => s.filter((_, j) => j !== idx));
    setSlideIdx(Math.max(0, idx - 1));
    setSelectedId(null);
  };
  const moveSlide = (d: number) => {
    const to = idx + d;
    if (to < 0 || to >= slides.length) return;
    setSlides((s) => {
      const a = [...s];
      [a[idx], a[to]] = [a[to], a[idx]];
      return a;
    });
    setSlideIdx(to);
  };

  return (
    <Stack spacing={2}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={onFile}
      />
      {/* 上部バー */}
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        <Button size="small" component={RouterLink} to="/decks">
          ← 一覧
        </Button>
        <Tooltip title="元に戻す (Ctrl/⌘+Z)">
          <span>
            <IconButton size="small" onClick={undo} disabled={!canUndo}>
              <UndoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="やり直す (Ctrl/⌘+Shift+Z)">
          <span>
            <IconButton size="small" onClick={redo} disabled={!canRedo}>
              <RedoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <TextField
          size="small"
          placeholder="スライドのタイトル"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          sx={{ flex: 1, minWidth: 180 }}
        />
        <Typography variant="caption" color="text.secondary">
          {update.isPending ? "保存中…" : "自動保存"}
        </Typography>
        {deck && (
          <Button
            size="small"
            variant="outlined"
            component={RouterLink}
            to={`/d/${deck.slug}`}
            target="_blank"
          >
            公開ビューア
          </Button>
        )}
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        {/* スライド一覧 */}
        <Stack spacing={1} sx={{ width: { md: 160 }, flexShrink: 0 }}>
          {slides.map((s, j) => (
            <Box
              key={s.id}
              onClick={() => {
                setSlideIdx(j);
                setSelectedId(null);
              }}
              sx={{
                cursor: "pointer",
                border: "2px solid",
                borderColor: j === idx ? "primary.main" : "divider",
                borderRadius: 1,
                aspectRatio: "16 / 9",
                bgcolor: s.background,
                position: "relative",
                overflow: "hidden",
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  position: "absolute",
                  top: 2,
                  left: 4,
                  color: "rgba(0,0,0,0.5)",
                }}
              >
                {j + 1}
              </Typography>
            </Box>
          ))}
          <Button size="small" onClick={addSlide}>
            ＋ ページ追加
          </Button>
          <Stack direction="row" spacing={0.5} justifyContent="center">
            <Tooltip title="複製">
              <IconButton size="small" onClick={dupSlide}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="上へ">
              <IconButton size="small" onClick={() => moveSlide(-1)}>
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="下へ">
              <IconButton size="small" onClick={() => moveSlide(1)}>
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="削除">
              <IconButton
                size="small"
                onClick={delSlide}
                disabled={slides.length <= 1}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        {/* キャンバス */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }} alignItems="center">
            <Button size="small" startIcon={<TextFieldsIcon />} onClick={addText}>
              テキスト
            </Button>
            <Button size="small" startIcon={<ImageIcon />} onClick={addImage}>
              画像
            </Button>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography variant="caption">背景</Typography>
              <input
                type="color"
                value={slide?.background ?? "#ffffff"}
                onChange={(e) => patchSlide(idx, { background: e.target.value })}
              />
            </Box>
          </Stack>
          <Box ref={canvasRef} sx={{ width: "100%" }}>
            {slide && scale > 0 && (
              <Box
                onMouseDown={() => setSelectedId(null)}
                sx={{
                  position: "relative",
                  width: cw,
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
                  {slide.elements.map((el) => (
                    <Rnd
                      key={el.id}
                      scale={scale}
                      bounds="parent"
                      size={{ width: el.w, height: el.h }}
                      position={{ x: el.x, y: el.y }}
                      enableResizing={false}
                      onDragStart={() => setSelectedId(el.id)}
                      onDrag={(_e, d) =>
                        setDragXY({ id: el.id, x: d.x, y: d.y })
                      }
                      onDragStop={(_e, d) => {
                        patchElement(el.id, { x: d.x, y: d.y });
                        setDragXY(null);
                      }}
                      onResizeStop={(_e, _dir, ref, _delta, pos) =>
                        patchElement(el.id, {
                          w: parseFloat(ref.style.width),
                          h: parseFloat(ref.style.height),
                          x: pos.x,
                          y: pos.y,
                        })
                      }
                      onMouseDown={(e: MouseEvent) => {
                        e.stopPropagation();
                        setSelectedId(el.id);
                      }}
                      style={{
                        outline:
                          selectedId === el.id
                            ? "2px solid #2563eb"
                            : "1px dashed rgba(0,0,0,0.25)",
                        zIndex: selectedId === el.id ? 5 : 1,
                        touchAction: "none",
                      }}
                    >
                      <ElementContent el={el} />
                    </Rnd>
                  ))}

                  {/* 自前リサイズハンドル（選択中の要素の四隅） */}
                  {selected &&
                    (
                      [
                        ["nw", "nwse-resize"],
                        ["ne", "nesw-resize"],
                        ["sw", "nesw-resize"],
                        ["se", "nwse-resize"],
                      ] as const
                    ).map(([corner, cursor]) => {
                      const bx =
                        dragXY?.id === selected.id ? dragXY.x : selected.x;
                      const by =
                        dragXY?.id === selected.id ? dragXY.y : selected.y;
                      const left =
                        (corner.includes("w") ? bx : bx + selected.w) - hs / 2;
                      const top =
                        (corner.includes("n") ? by : by + selected.h) - hs / 2;
                      return (
                        <div
                          key={corner}
                          onPointerDown={(e) => startResize(e, selected, corner)}
                          onPointerMove={moveResize}
                          onPointerUp={endResize}
                          style={{
                            position: "absolute",
                            left,
                            top,
                            width: hs,
                            height: hs,
                            borderRadius: "50%",
                            background: "#2563eb",
                            border: `${hb}px solid #fff`,
                            boxSizing: "border-box",
                            cursor,
                            touchAction: "none",
                            zIndex: 10,
                          }}
                        />
                      );
                    })}
                </Box>
              </Box>
            )}
          </Box>
        </Box>

        {/* プロパティ */}
        <Stack spacing={1.5} sx={{ width: { md: 240 }, flexShrink: 0 }}>
          {selected ? (
            <>
              <Typography variant="subtitle2">
                {selected.type === "text" ? "テキスト" : "画像"}
              </Typography>
              {selected.type === "text" && (
                <>
                  <TextField
                    size="small"
                    label="内容"
                    multiline
                    minRows={2}
                    value={selected.text ?? ""}
                    onChange={(e) =>
                      patchElement(selected.id, { text: e.target.value })
                    }
                  />
                  <TextField
                    select
                    size="small"
                    label="フォント"
                    value={selected.fontFamily ?? ""}
                    onChange={(e) => {
                      ensureDeckFont(e.target.value);
                      patchElement(selected.id, { fontFamily: e.target.value });
                    }}
                  >
                    {DECK_FONTS.map((f) => (
                      <MenuItem
                        key={f.label}
                        value={f.family}
                        onMouseEnter={() => ensureDeckFont(f.family)}
                        style={{ fontFamily: f.family || undefined }}
                      >
                        {f.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      文字サイズ：{selected.fontSize ?? 40}
                    </Typography>
                    <Slider
                      size="small"
                      min={12}
                      max={160}
                      value={selected.fontSize ?? 40}
                      onChange={(_e, v) =>
                        patchElement(selected.id, { fontSize: v as number })
                      }
                    />
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="caption">色</Typography>
                    <input
                      type="color"
                      value={selected.color ?? "#0f172a"}
                      onChange={(e) =>
                        patchElement(selected.id, { color: e.target.value })
                      }
                    />
                    <ToggleButton
                      size="small"
                      value="bold"
                      selected={Boolean(selected.bold)}
                      onChange={() =>
                        patchElement(selected.id, { bold: !selected.bold })
                      }
                    >
                      <FormatBoldIcon fontSize="small" />
                    </ToggleButton>
                  </Box>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={selected.align ?? "left"}
                    onChange={(_e, v) =>
                      v && patchElement(selected.id, { align: v })
                    }
                  >
                    <ToggleButton value="left">左</ToggleButton>
                    <ToggleButton value="center">中</ToggleButton>
                    <ToggleButton value="right">右</ToggleButton>
                  </ToggleButtonGroup>
                </>
              )}
              {selected.type === "image" && (
                <>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ImageIcon />}
                    disabled={upload.isPending}
                    onClick={() =>
                      pickImage((url) => patchElement(selected.id, { src: url }))
                    }
                  >
                    {upload.isPending ? "アップロード中…" : "画像を差し替え"}
                  </Button>
                  <TextField
                    size="small"
                    label="画像URL（直接指定）"
                    value={selected.src ?? ""}
                    onChange={(e) =>
                      patchElement(selected.id, { src: e.target.value })
                    }
                  />
                </>
              )}
              <Divider />
              <Button
                size="small"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                onClick={() => deleteElement(selected.id)}
              >
                この要素を削除
              </Button>
            </>
          ) : (
            <Typography variant="caption" color="text.secondary">
              要素を選ぶと編集できます。「テキスト」「画像」から追加し、ドラッグで移動・隅でリサイズ。
            </Typography>
          )}
        </Stack>
      </Stack>
    </Stack>
  );
}

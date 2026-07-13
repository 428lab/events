import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Divider,
  Fab,
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
import VideocamIcon from "@mui/icons-material/Videocam";
import SlideshowIcon from "@mui/icons-material/Slideshow";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import FlipToFrontIcon from "@mui/icons-material/FlipToFront";
import FlipToBackIcon from "@mui/icons-material/FlipToBack";
import { Link as RouterLink, useParams } from "react-router-dom";
import { Rnd } from "react-rnd";
import { EVENT_INFO_FIELDS, LIVE_H, LIVE_W } from "@eventer/shared";
import type {
  EventInfoField,
  LiveElement,
  LiveScene,
  LiveSetContent,
} from "@eventer/shared";
import {
  useLiveSet,
  useUpdateLiveSet,
  useUploadLiveSetImage,
} from "../api/liveSetHooks.js";
import { LiveElementContent, LiveSceneStage } from "../components/LiveStage.js";
import { DECK_FONTS, ensureDeckFont } from "../lib/deckFonts.js";
import { encodeImageForUpload } from "../lib/encodeImage.js";

const uid = () => crypto.randomUUID();
const THUMB_W = 150;

const INFO_LABEL: Record<EventInfoField, string> = {
  title: "イベントタイトル",
  datetime: "開催日時",
  participants: "参加人数",
  community: "コミュニティ名",
};

const TYPE_LABEL: Record<LiveElement["type"], string> = {
  text: "テキスト",
  image: "画像",
  camera: "カメラ",
  deck: "スライド",
  eventInfo: "イベント情報",
};

/** 背景プリセット（Natsumatsuri トーン） */
const BG_PRESETS = [
  { label: "夜空", value: "#0E1426" },
  { label: "黒", value: "#000000" },
  { label: "夜祭グラデ", value: "linear-gradient(135deg, #0B3A34 0%, #0E1426 60%)" },
  { label: "宵グラデ", value: "linear-gradient(135deg, #0E1426 40%, #0B3A34 100%)" },
  { label: "白", value: "#ffffff" },
];

export function LiveSetEditorPage() {
  const { id = "" } = useParams();
  const { data: liveSet, isLoading, isError } = useLiveSet(id);
  const update = useUpdateLiveSet(id);
  const upload = useUploadLiveSetImage(id);
  const fileRef = useRef<HTMLInputElement>(null);
  const onPicked = useRef<(url: string) => void>(() => {});
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

  const [name, setName] = useState("");
  const [content, setContent] = useState<LiveSetContent | null>(null);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragXY, setDragXY] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const inited = useRef(false);

  // 履歴（Undo/Redo）
  const undoStack = useRef<LiveSetContent[]>([]);
  const redoStack = useRef<LiveSetContent[]>([]);
  const lastCommitted = useRef<LiveSetContent | null>(null);
  const histTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [histVer, setHistVer] = useState(0);

  useEffect(() => {
    if (liveSet && !inited.current) {
      setName(liveSet.name);
      setContent(liveSet.content);
      lastCommitted.current = liveSet.content;
      inited.current = true;
    }
  }, [liveSet]);

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

  // 自動保存
  const firstSave = useRef(true);
  useEffect(() => {
    if (content === null) return;
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    const t = setTimeout(() => update.mutate({ name, content }), 800);
    return () => clearTimeout(t);
  }, [content, name]);

  const keydownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keydownRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  if (isError) return <Typography>配信セットが見つかりません。</Typography>;
  if (isLoading || !content) return <Typography>読み込み中…</Typography>;

  const scenes = content.scenes;
  const idx = Math.min(sceneIdx, scenes.length - 1);
  const scene: LiveScene | undefined = scenes[idx];
  const scale = cw > 0 ? cw / LIVE_W : 0;
  const els = scene?.elements ?? [];
  const selected = els.find((e) => e.id === selectedId) ?? null;

  const hs = Math.max(12, Math.round(24 / (scale || 1)));
  const hb = Math.max(1, Math.round(2 / (scale || 1)));

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
  keydownRef.current = (e: KeyboardEvent) => {
    const tag = (document.activeElement?.tagName ?? "").toLowerCase();
    const typing = tag === "input" || tag === "textarea";
    if (e.metaKey || e.ctrlKey) {
      const k = e.key.toLowerCase();
      if ((k === "z" || k === "y") && !typing) {
        e.preventDefault();
        if (k === "y" || (k === "z" && e.shiftKey)) redo();
        else undo();
      } else if (k === "d" && selectedId && !typing) {
        e.preventDefault();
        duplicateSelected();
      }
      return;
    }
    if (typing || !selectedId) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSelected();
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveSelected(-step, 0);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      moveSelected(step, 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelected(0, -step);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelected(0, step);
    }
  };
  void histVer;
  const canUndo =
    undoStack.current.length > 0 ||
    (lastCommitted.current !== null && content !== lastCommitted.current);
  const canRedo = redoStack.current.length > 0;

  const setScenes = (fn: (s: LiveScene[]) => LiveScene[]) =>
    setContent((c) => (c ? { ...c, scenes: fn(c.scenes) } : c));
  const patchScene = (i: number, patch: Partial<LiveScene>) =>
    setScenes((s) => s.map((sc, j) => (j === i ? { ...sc, ...patch } : sc)));
  const mapCurrentScene = (fn: (els: LiveElement[]) => LiveElement[]) =>
    setScenes((s) =>
      s.map((sc, j) => (j === idx ? { ...sc, elements: fn(sc.elements) } : sc)),
    );
  const patchElement = (elId: string, patch: Partial<LiveElement>) =>
    mapCurrentScene((arr) =>
      arr.map((e) => (e.id === elId ? { ...e, ...patch } : e)),
    );
  const addElement = (el: LiveElement) => {
    mapCurrentScene((arr) => [...arr, el]);
    setSelectedId(el.id);
  };
  const moveZ = (elId: string, dir: 1 | -1) =>
    mapCurrentScene((arr) => {
      const a = [...arr];
      const i = a.findIndex((e) => e.id === elId);
      const to = i + dir;
      if (i < 0 || to < 0 || to >= a.length) return arr;
      [a[i], a[to]] = [a[to], a[i]];
      return a;
    });
  const moveSelected = (dx: number, dy: number) =>
    mapCurrentScene((arr) =>
      arr.map((e) =>
        e.id === selectedId ? { ...e, x: e.x + dx, y: e.y + dy } : e,
      ),
    );
  const deleteSelected = () => {
    if (!selectedId) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    mapCurrentScene((arr) => arr.filter((e) => e.id !== selectedId));
    setSelectedId(null);
  };
  const duplicateSelected = () => {
    const src = els.find((e) => e.id === selectedId);
    if (!src) return;
    const copy = { ...src, id: uid(), x: src.x + 20, y: src.y + 20 };
    mapCurrentScene((arr) => [...arr, copy]);
    setSelectedId(copy.id);
  };
  const frontSelected = () =>
    mapCurrentScene((arr) => [
      ...arr.filter((e) => e.id !== selectedId),
      ...arr.filter((e) => e.id === selectedId),
    ]);
  const backSelected = () =>
    mapCurrentScene((arr) => [
      ...arr.filter((e) => e.id === selectedId),
      ...arr.filter((e) => e.id !== selectedId),
    ]);

  // 自前リサイズ
  const startResize = (e: React.PointerEvent, el: LiveElement, corner: string) => {
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
      color: "#EAF0F7",
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
  const addCamera = () =>
    addElement({
      id: uid(),
      type: "camera",
      x: 640,
      y: 340,
      w: 280,
      h: 180,
      rotation: 0,
      fit: "cover",
      radius: 12,
    });
  const addDeck = () =>
    addElement({
      id: uid(),
      type: "deck",
      x: 0,
      y: 0,
      w: 720,
      h: 405,
      rotation: 0,
    });
  const addEventInfo = () =>
    addElement({
      id: uid(),
      type: "eventInfo",
      field: "title",
      x: 120,
      y: 40,
      w: 720,
      h: 80,
      rotation: 0,
      fontSize: 36,
      color: "#EAF0F7",
      bold: true,
      align: "center",
    });

  const addScene = () => {
    const ns: LiveScene = {
      id: uid(),
      name: `シーン ${scenes.length + 1}`,
      background: "#0E1426",
      elements: [],
    };
    setScenes((s) => [...s.slice(0, idx + 1), ns, ...s.slice(idx + 1)]);
    setSceneIdx(idx + 1);
    setSelectedId(null);
  };
  const dupScene = () => {
    const copy: LiveScene = {
      ...scene!,
      id: uid(),
      name: `${scene!.name}のコピー`,
      elements: scene!.elements.map((e) => ({ ...e, id: uid() })),
    };
    setScenes((s) => [...s.slice(0, idx + 1), copy, ...s.slice(idx + 1)]);
    setSceneIdx(idx + 1);
  };
  const delScene = () => {
    if (scenes.length <= 1) return;
    setScenes((s) => s.filter((_, j) => j !== idx));
    setSceneIdx(Math.max(0, idx - 1));
    setSelectedId(null);
  };
  const moveScene = (d: number) => {
    const to = idx + d;
    if (to < 0 || to >= scenes.length) return;
    setScenes((s) => {
      const a = [...s];
      [a[idx], a[to]] = [a[to], a[idx]];
      return a;
    });
    setSceneIdx(to);
  };

  const bgIsColor = /^#[0-9a-fA-F]{3,8}$/.test(scene?.background ?? "");

  return (
    <Stack spacing={2}>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      {/* 上部バー */}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button size="small" component={RouterLink} to="/live-sets">
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
          placeholder="配信セット名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ flex: 1, minWidth: 180 }}
        />
        <Typography variant="caption" color="text.secondary">
          {update.isPending ? "保存中…" : "自動保存"}
        </Typography>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        {/* シーン一覧 */}
        <Stack spacing={1} sx={{ width: { md: 168 }, flexShrink: 0 }}>
          {scenes.map((s, j) => (
            <Box
              key={s.id}
              onClick={() => {
                setSceneIdx(j);
                setSelectedId(null);
              }}
              sx={{
                cursor: "pointer",
                border: "2px solid",
                borderColor: j === idx ? "primary.main" : "divider",
                borderRadius: 1,
                position: "relative",
                overflow: "hidden",
                lineHeight: 0,
              }}
            >
              <Box sx={{ pointerEvents: "none" }}>
                <LiveSceneStage scene={s} width={THUMB_W} />
              </Box>
              <Typography
                variant="caption"
                sx={{
                  position: "absolute",
                  bottom: 2,
                  left: 4,
                  right: 4,
                  px: 0.5,
                  borderRadius: 0.5,
                  bgcolor: "rgba(0,0,0,0.55)",
                  color: "#fff",
                  lineHeight: 1.5,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.name}
              </Typography>
            </Box>
          ))}
          <Button size="small" onClick={addScene}>
            ＋ シーン追加
          </Button>
          <Stack direction="row" spacing={0.5} justifyContent="center">
            <Tooltip title="複製">
              <IconButton size="small" onClick={dupScene}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="上へ">
              <IconButton size="small" onClick={() => moveScene(-1)}>
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="下へ">
              <IconButton size="small" onClick={() => moveScene(1)}>
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="削除">
              <IconButton size="small" onClick={delScene} disabled={scenes.length <= 1}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        {/* キャンバス */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ mb: 1 }}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            <TextField
              size="small"
              label="シーン名"
              value={scene?.name ?? ""}
              onChange={(e) => patchScene(idx, { name: e.target.value })}
              sx={{ width: 160 }}
            />
            <Button size="small" startIcon={<TextFieldsIcon />} onClick={addText}>
              テキスト
            </Button>
            <Button size="small" startIcon={<ImageIcon />} onClick={addImage}>
              画像
            </Button>
            <Button size="small" startIcon={<VideocamIcon />} onClick={addCamera}>
              カメラ
            </Button>
            <Button size="small" startIcon={<SlideshowIcon />} onClick={addDeck}>
              スライド
            </Button>
            <Button size="small" startIcon={<InfoOutlinedIcon />} onClick={addEventInfo}>
              イベント情報
            </Button>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            sx={{ mb: 1 }}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            <Typography variant="caption">背景</Typography>
            <input
              type="color"
              value={bgIsColor ? scene!.background : "#0E1426"}
              onChange={(e) => patchScene(idx, { background: e.target.value })}
            />
            <TextField
              select
              size="small"
              value={
                BG_PRESETS.find((p) => p.value === scene?.background)?.value ?? ""
              }
              onChange={(e) => patchScene(idx, { background: e.target.value })}
              sx={{ width: 140 }}
              SelectProps={{ displayEmpty: true }}
            >
              <MenuItem value="" disabled>
                プリセット
              </MenuItem>
              {BG_PRESETS.map((p) => (
                <MenuItem key={p.label} value={p.value}>
                  {p.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Box
            ref={canvasRef}
            sx={{ width: "100%", maxWidth: "calc(80vh * 16 / 9)" }}
          >
            {scene && scale > 0 && (
              <Box
                onMouseDown={() => setSelectedId(null)}
                sx={{
                  position: "relative",
                  width: cw,
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
                      enableResizing={false}
                      onDrag={(_e, d) => setDragXY({ id: el.id, x: d.x, y: d.y })}
                      onDragStop={(_e, d) => {
                        if (d.x !== el.x || d.y !== el.y) {
                          patchElement(el.id, { x: d.x, y: d.y });
                        }
                        setDragXY(null);
                      }}
                      onMouseDown={(e: MouseEvent) => {
                        e.stopPropagation();
                        setSelectedId(el.id);
                      }}
                      style={{
                        outline:
                          selectedId === el.id
                            ? "2px solid #2563eb"
                            : "1px dashed rgba(148,163,184,0.4)",
                        touchAction: "none",
                      }}
                    >
                      <LiveElementContent el={el} />
                    </Rnd>
                  ))}

                  {selected &&
                    (
                      [
                        ["nw", "nwse-resize"],
                        ["ne", "nesw-resize"],
                        ["sw", "nesw-resize"],
                        ["se", "nwse-resize"],
                      ] as const
                    ).map(([corner, cursor]) => {
                      const bx = dragXY?.id === selected.id ? dragXY.x : selected.x;
                      const by = dragXY?.id === selected.id ? dragXY.y : selected.y;
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
          {!selected ? (
            <Typography variant="caption" color="text.secondary">
              要素を選ぶと編集できます。上のボタンから追加し、ドラッグで移動・隅でリサイズ。
              カメラ・スライドの中身は配信画面で自動的に流し込まれます。
            </Typography>
          ) : (
            <>
              <Typography variant="subtitle2">{TYPE_LABEL[selected.type]}</Typography>

              {selected.type === "text" && (
                <TextField
                  size="small"
                  label="内容"
                  multiline
                  minRows={2}
                  value={selected.text ?? ""}
                  onChange={(e) => patchElement(selected.id, { text: e.target.value })}
                />
              )}

              {selected.type === "eventInfo" && (
                <TextField
                  select
                  size="small"
                  label="表示する情報"
                  value={selected.field ?? "title"}
                  onChange={(e) =>
                    patchElement(selected.id, {
                      field: e.target.value as EventInfoField,
                    })
                  }
                >
                  {EVENT_INFO_FIELDS.map((f) => (
                    <MenuItem key={f} value={f}>
                      {INFO_LABEL[f]}
                    </MenuItem>
                  ))}
                </TextField>
              )}

              {(selected.type === "text" || selected.type === "eventInfo") && (
                <>
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
                      value={selected.color ?? "#EAF0F7"}
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
                    onChange={(_e, v) => v && patchElement(selected.id, { align: v })}
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

              {selected.type === "camera" && (
                <>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={selected.fit ?? "cover"}
                    onChange={(_e, v) => v && patchElement(selected.id, { fit: v })}
                  >
                    <ToggleButton value="cover">枠いっぱい</ToggleButton>
                    <ToggleButton value="contain">全体表示</ToggleButton>
                  </ToggleButtonGroup>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      角丸：{selected.radius ?? 0}
                    </Typography>
                    <Slider
                      size="small"
                      min={0}
                      max={200}
                      value={selected.radius ?? 0}
                      onChange={(_e, v) =>
                        patchElement(selected.id, { radius: v as number })
                      }
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    カメラ映像は配信画面タブで流し込まれます。
                  </Typography>
                </>
              )}

              {selected.type === "deck" && (
                <Typography variant="caption" color="text.secondary">
                  イベントで選択したスライドがここに表示されます。ページ送りはコントロール画面から。
                </Typography>
              )}

              <Divider />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button
                  size="small"
                  startIcon={<ContentCopyIcon />}
                  onClick={duplicateSelected}
                >
                  複製
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                重なり順
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                <Button size="small" startIcon={<FlipToFrontIcon />} onClick={frontSelected}>
                  最前面
                </Button>
                <Button size="small" onClick={() => moveZ(selected.id, 1)}>
                  前面へ
                </Button>
                <Button size="small" onClick={() => moveZ(selected.id, -1)}>
                  背面へ
                </Button>
                <Button size="small" startIcon={<FlipToBackIcon />} onClick={backSelected}>
                  最背面
                </Button>
              </Stack>
              <Button
                size="small"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                onClick={deleteSelected}
              >
                この要素を削除
              </Button>
            </>
          )}
        </Stack>
      </Stack>

      {/* スマホ用：画面下に固定の Undo/Redo */}
      <Box
        sx={{
          display: { xs: "flex", md: "none" },
          position: "fixed",
          bottom: 16,
          right: 16,
          gap: 1,
          zIndex: (t) => t.zIndex.fab,
        }}
      >
        <Fab size="small" onClick={undo} disabled={!canUndo}>
          <UndoIcon />
        </Fab>
        <Fab size="small" onClick={redo} disabled={!canRedo}>
          <RedoIcon />
        </Fab>
      </Box>
    </Stack>
  );
}

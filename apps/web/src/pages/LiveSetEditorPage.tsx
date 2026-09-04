import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Fab,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import RedoIcon from "@mui/icons-material/Redo";
import UndoIcon from "@mui/icons-material/Undo";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { LiveElement, LiveScene, LiveSetContent } from "@eventer/shared";
import {
  useLiveSet,
  useUpdateLiveSet,
  useUploadLiveSetImage,
} from "../api/liveSetHooks.js";
import { useBgmTracks } from "../api/bgmHooks.js";
import { LiveCanvas } from "../components/LiveCanvas.js";
import { LiveElementPanel } from "../components/LiveElementPanel.js";
import { LiveSceneList } from "../components/LiveSceneList.js";
import { LiveSceneToolbar } from "../components/LiveSceneToolbar.js";
import {
  copyScene,
  newImageElement,
  newScene,
} from "../lib/liveScenes.js";
import type {
  LiveElementCommands,
  LiveSceneCommands,
} from "../lib/liveScenes.js";
import {
  applyPositions,
  copyByIds,
  insertAfter,
  mapElementsAt,
  moveZ,
  nudgeByIds,
  patchAt,
  patchById,
  removeAt,
  removeByIds,
  swapAt,
  toBack,
  toFront,
} from "../lib/editor/collection.js";
import { useAutoSave } from "../lib/editor/useAutoSave.js";
import { useEditorHistory } from "../lib/editor/useEditorHistory.js";
import { useEditorKeyboard } from "../lib/editor/useEditorKeyboard.js";
import { useImagePicker } from "../lib/editor/useImagePicker.js";

/**
 * 配信セットの編集画面。
 *
 * ここが持つのは「いま何を編集しているか」（開いているシーン・選んでいる要素）と、
 * 各部への結線だけ。並びを変える式は lib/editor/collection.ts、配信セット固有の
 * 既定値は lib/liveScenes.ts に純粋な関数として置き、履歴・自動保存・キーボード・
 * 画像の差し込みは lib/editor/ にまとめてある
 * （スライドの編集画面と同じ仕掛けなので、契約を2つ持たない）。
 */
export function LiveSetEditorPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: liveSet, isLoading, isError } = useLiveSet(id);
  const update = useUpdateLiveSet(id);
  const upload = useUploadLiveSetImage(id);
  const { data: bgmTracks } = useBgmTracks();

  const [name, setName] = useState("");
  const [content, setContent] = useState<LiveSetContent | null>(null);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const loaded = useRef(false);

  const history = useEditorHistory<LiveSetContent>({
    content,
    setContent,
    // 戻した先に無い要素を選んだままにしない
    onRestore: () => setSelectedId(null),
  });

  useEffect(() => {
    if (!liveSet || loaded.current) return;
    setName(liveSet.name);
    setContent(liveSet.content);
    history.reset(liveSet.content);
    loaded.current = true;
    // history は ref だけを触るので、毎レンダの作り直しでは追わない
  }, [liveSet]);

  useAutoSave({
    ready: content !== null,
    deps: [content, name],
    onSave: () => {
      if (content) update.mutate({ name, content });
    },
  });

  const picker = useImagePicker(upload.mutateAsync);

  // ここから下は content が無い間も素通りできる形にしておく
  // （フックを早期 return より後ろに置けないため）
  const scenes = content?.scenes ?? [];
  const idx = Math.min(sceneIdx, scenes.length - 1);
  const scene: LiveScene | undefined = scenes[idx];
  const els = scene?.elements ?? [];
  const selected = els.find((e) => e.id === selectedId) ?? null;

  const editScenes = (fn: (s: LiveScene[]) => LiveScene[]) =>
    setContent((c) => (c ? { ...c, scenes: fn(c.scenes) } : c));
  const editEls = (fn: (arr: LiveElement[]) => LiveElement[]) =>
    editScenes((s) => mapElementsAt(s, idx, fn));

  const addElement = (el: LiveElement) => {
    editEls((arr) => [...arr, el]);
    setSelectedId(el.id);
  };

  const sceneCommands: LiveSceneCommands = {
    add: () => {
      editScenes((s) => insertAfter(s, idx, newScene(scenes.length)));
      setSceneIdx(idx + 1);
      setSelectedId(null);
    },
    duplicate: () => {
      if (!scene) return;
      editScenes((s) => insertAfter(s, idx, copyScene(scene)));
      setSceneIdx(idx + 1);
    },
    remove: () => {
      if (scenes.length <= 1) return;
      editScenes((s) => removeAt(s, idx));
      setSceneIdx(Math.max(0, idx - 1));
      setSelectedId(null);
    },
    move: (d) => {
      const to = idx + d;
      if (to < 0 || to >= scenes.length) return;
      editScenes((s) => swapAt(s, idx, to));
      setSceneIdx(to);
    },
  };

  /** 選択している1つに効く操作。選んでいなければ何もしない */
  const forSelected = (fn: (elId: string) => void) => () => {
    if (selectedId) fn(selectedId);
  };

  const elementCommands: LiveElementCommands = {
    patch: (elId, patch) => editEls((arr) => patchById(arr, elId, patch)),
    remove: forSelected((elId) => {
      // 消したボタンからフォーカスが外れたままにしない
      (document.activeElement as HTMLElement | null)?.blur?.();
      editEls((arr) => removeByIds(arr, [elId]));
      setSelectedId(null);
    }),
    duplicate: forSelected((elId) => {
      const copies = copyByIds(els, [elId]);
      if (copies.length === 0) return;
      editEls((arr) => [...arr, ...copies]);
      // 続けて動かせるよう、写した側に選択を移す
      setSelectedId(copies[0].id);
    }),
    toFront: forSelected((elId) => editEls((arr) => toFront(arr, [elId]))),
    toBack: forSelected((elId) => editEls((arr) => toBack(arr, [elId]))),
    moveZ: (elId, dir) => editEls((arr) => moveZ(arr, elId, dir)),
    nudge: (dx, dy) => {
      if (selectedId) editEls((arr) => nudgeByIds(arr, [selectedId], dx, dy));
    },
    moveTo: (elId, x, y) =>
      editEls((arr) => applyPositions(arr, [{ id: elId, x, y }])),
  };

  useEditorKeyboard({
    undo: history.undo,
    redo: history.redo,
    hasSelection: selectedId !== null,
    remove: elementCommands.remove,
    duplicate: elementCommands.duplicate,
    nudge: elementCommands.nudge,
    // まとめる操作は配信セットには無い（選択が常に1つ）ので渡さない
  });

  if (isError) return <Typography>{t("studio.liveSetNotFound")}</Typography>;
  if (isLoading || !content)
    return <Typography>{t("common.loading")}</Typography>;

  return (
    <Stack spacing={2}>
      {picker.input}

      {/* 上部バー */}
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        <Button size="small" component={RouterLink} to="/live-sets">
          {t("studio.backToList")}
        </Button>
        <Tooltip title={t("studio.undoTip")}>
          <span>
            <IconButton
              size="small"
              onClick={history.undo}
              disabled={!history.canUndo}
            >
              <UndoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("studio.redoTip")}>
          <span>
            <IconButton
              size="small"
              onClick={history.redo}
              disabled={!history.canRedo}
            >
              <RedoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <TextField
          size="small"
          placeholder={t("studio.liveSetNamePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ flex: 1, minWidth: 180 }}
        />
        <Typography variant="caption" color="text.secondary">
          {update.isPending ? t("studio.saving") : t("studio.autoSaved")}
        </Typography>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Stack spacing={1} sx={{ width: { md: 168 }, flexShrink: 0 }}>
          <LiveSceneList
            scenes={scenes}
            current={idx}
            onSelect={(j) => {
              setSceneIdx(j);
              setSelectedId(null);
            }}
            commands={sceneCommands}
          />
        </Stack>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <LiveSceneToolbar
            scene={scene}
            bgmTracks={bgmTracks}
            onPatchScene={(patch) => editScenes((s) => patchAt(s, idx, patch))}
            onAdd={addElement}
            onAddImage={() =>
              picker.pick((url) => addElement(newImageElement(url)))
            }
          />
          <LiveCanvas
            scene={scene}
            selected={selected}
            commands={elementCommands}
            onSelect={setSelectedId}
            onSelectNone={() => setSelectedId(null)}
          />
        </Box>

        <Stack spacing={1.5} sx={{ width: { md: 240 }, flexShrink: 0 }}>
          <LiveElementPanel
            selected={selected}
            commands={elementCommands}
            pickImage={picker.pick}
            uploading={upload.isPending}
          />
        </Stack>
      </Stack>

      {/* スマホ用：画面下に固定の Undo/Redo（上部バーが隠れるため） */}
      <Box
        sx={{
          display: { xs: "flex", md: "none" },
          position: "fixed",
          bottom: 16,
          right: 16,
          gap: 1,
          zIndex: (theme) => theme.zIndex.fab,
        }}
      >
        <Fab size="small" onClick={history.undo} disabled={!history.canUndo}>
          <UndoIcon />
        </Fab>
        <Fab size="small" onClick={history.redo} disabled={!history.canRedo}>
          <RedoIcon />
        </Fab>
      </Box>
    </Stack>
  );
}

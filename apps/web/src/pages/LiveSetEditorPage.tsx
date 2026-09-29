import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RedoIcon from "@mui/icons-material/Redo";
import ScheduleIcon from "@mui/icons-material/Schedule";
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
import { LiveAddPartDialog } from "../components/LiveAddPartDialog.js";
import { LiveCanvas } from "../components/LiveCanvas.js";
import { LiveElementPanel } from "../components/LiveElementPanel.js";
import { LiveSceneList } from "../components/LiveSceneList.js";
import { LiveSceneToolbar } from "../components/LiveSceneToolbar.js";
import {
  copyScene,
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
  const [saveStatus, setSaveStatus] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [editError, setEditError] = useState("");
  const [pauseMotion, setPauseMotion] = useState(false);
  const [sampleTime, setSampleTime] = useState(false);
  const [addPartOpen, setAddPartOpen] = useState(false);
  const savedRevision = useRef<number | null>(null);
  const saving = useRef(false);
  const queued = useRef<typeof latest.current | null>(null);
  const latest = useRef({ content, name });
  latest.current = { content, name };

  const history = useEditorHistory<LiveSetContent>({
    content,
    setContent,
    // 戻した先に無い要素を選んだままにしない
    onRestore: () => setSelectedId(null),
  });

  useEffect(() => {
    if (!liveSet || loaded.current) return;
    setName(liveSet.name);
    savedRevision.current = liveSet.updatedAt;
    setContent(liveSet.content);
    history.reset(liveSet.content);
    loaded.current = true;
    // history は ref だけを触るので、毎レンダの作り直しでは追わない
  }, [liveSet]);

  const save = () => {
    const snapshot = latest.current;
    if (!snapshot.content) return;
    if (saving.current) { queued.current = snapshot; return; }
    saving.current = true;
    setSaveStatus("saving");
    // Invoke immediately; a later edit is queued until this full-content write settles.
    Promise.resolve(update.mutateAsync({ name: snapshot.name, content: snapshot.content!, baseUpdatedAt: savedRevision.current ?? undefined }))
      .then(result => { if (result?.updatedAt !== undefined) savedRevision.current = result.updatedAt; setSaveStatus(latest.current.content === snapshot.content && latest.current.name === snapshot.name ? "saved" : "dirty"); })
      .catch(() => setSaveStatus("error"))
      .finally(() => { saving.current = false; if (queued.current) { queued.current = null; save(); } });
  };
  useEffect(() => { if (loaded.current && content) setSaveStatus("dirty"); }, [content, name]);
  useAutoSave({ ready: content !== null, deps: [content, name], onSave: save });

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

  /** 置けたら true。上限を超えるときは理由を出して何も置かない */
  const addElements = (elements: LiveElement[]): boolean => {
    if (els.length + elements.length > 50) { setEditError(t("studio.editorMaxElementsHelp")); return false; }
    if (els.filter(el => el.motion).length + elements.filter(el => el.motion).length > 2) { setEditError(t("studio.editorMaxMotionHelp")); return false; }
    setEditError("");
    editEls(arr => [...arr, ...elements]);
    setSelectedId(elements.find(e => e.type === "text" || e.type === "eventInfo")?.id ?? elements[0]?.id ?? null);
    return true;
  };
  const addElement = (el: LiveElement) => addElements([el]);
  const addPart = (elements: LiveElement[]) => {
    const keynoteName = scene?.id === "v1-hakuji-keynote" && elements.some(el => el.id === "name");
    return addElements(elements.map(el => ({ ...el, id: crypto.randomUUID(), x: el.x + (keynoteName ? 633 : 85), y: el.y + (keynoteName ? 356 : 230) })));
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
    patch: (elId, patch) => {
      if (patch.motion && !els.find(el => el.id === elId)?.motion && els.filter(el => el.motion).length >= 2) { setEditError(t("studio.editorMaxMotion")); return; }
      editEls((arr) => patchById(arr, elId, patch));
    },
    remove: forSelected((elId) => {
      // 消したボタンからフォーカスが外れたままにしない
      (document.activeElement as HTMLElement | null)?.blur?.();
      editEls((arr) => removeByIds(arr, [elId]));
      setSelectedId(null);
    }),
    duplicate: forSelected((elId) => {
      const copies = copyByIds(els, [elId]);
      if (copies.length === 0) return;
      if (els.length + copies.length > 50) { setEditError(t("studio.editorMaxElements")); return; }
      if (els.filter(el => el.motion).length + copies.filter(el => el.motion).length > 2) { setEditError(t("studio.editorMaxMotion")); return; }
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

  // 「パーツを追加」を開いている間は、矢印や Delete を背後の選択に効かせない
  const noop = () => {};
  useEditorKeyboard({
    undo: addPartOpen ? noop : history.undo,
    redo: addPartOpen ? noop : history.redo,
    hasSelection: selectedId !== null && !addPartOpen,
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
        <TextField
          size="small"
          placeholder={t("studio.liveSetNamePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ flex: 1, minWidth: 180 }}
        />
        <Typography variant="caption" color="text.secondary">
          {saveStatus === "saving" ? t("studio.saving") : saveStatus === "saved" ? t("studio.autoSaved") : saveStatus === "error" ? t("studio.editorSaveFailed") : t("studio.editorUnsaved")}
        </Typography>
      </Stack>

      {saveStatus === "error" && <Button color="error" onClick={save}>{t("studio.editorRetrySave")}</Button>}
      {editError && <Typography role="alert" color="error">{editError}</Typography>}
      <Typography variant="caption">{t("studio.editorPreviewHint")}</Typography>
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
            onOpenAddPart={() => setAddPartOpen(true)}
          />
          <LiveAddPartDialog
            open={addPartOpen}
            onClose={() => setAddPartOpen(false)}
            scene={scene}
            error={editError}
            onAddElement={addElement}
            onAddPart={addPart}
            pickImage={picker.pick}
            uploading={upload.isPending}
          />
          {/* キャンバスの見出し。元に戻す・やり直すは編集面のすぐ上に1か所だけ置き、
              スマホでは画面の上に貼り付けて、キャンバスを見ながら押せるようにする (#566) */}
          <Stack
            role="toolbar"
            aria-label={t("studio.canvasToolbar")}
            direction="row"
            alignItems="center"
            spacing={0.5}
            flexWrap="wrap"
            useFlexGap
            sx={{
              position: { xs: "sticky", md: "static" },
              top: 0,
              zIndex: (theme) => theme.zIndex.appBar - 1,
              bgcolor: "background.default",
              py: 0.5,
              mb: 0.5,
              borderBottom: { xs: 1, md: 0 },
              borderColor: "divider",
            }}
          >
            <Tooltip title={t("studio.undoTip")}>
              <span>
                <IconButton
                  size="small"
                  aria-label={t("studio.undoTip")}
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
                  aria-label={t("studio.redoTip")}
                  onClick={history.redo}
                  disabled={!history.canRedo}
                >
                  <RedoIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Box sx={{ width: "1px", alignSelf: "stretch", bgcolor: "divider", mx: 0.5 }} />
            <Button size="small" startIcon={pauseMotion ? <PlayArrowIcon /> : <PauseIcon />} onClick={() => setPauseMotion(p => !p)}>{t(pauseMotion ? "studio.editorResumeMotion" : "studio.editorPauseMotion")}</Button>
            <Button size="small" startIcon={<ScheduleIcon />} onClick={() => setSampleTime(p => !p)}>{t(sampleTime ? "studio.editorRealTime" : "studio.editorSampleTime")}</Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>{t(sampleTime ? "studio.editorSampleClock" : "studio.editorRealClock")}</Typography>
          <LiveCanvas
            pauseMotion={pauseMotion}
            previewNow={sampleTime ? Date.UTC(2026, 8, 27, 10, 4, 8) : undefined}
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

    </Stack>
  );
}

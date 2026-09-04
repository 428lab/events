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
import type { DeckContent, DeckElement, DeckSlide } from "@eventer/shared";
import {
  useDeck,
  useUpdateDeck,
  useUploadDeckImage,
} from "../api/deckHooks.js";
import { DeckCanvas } from "../components/DeckCanvas.js";
import { DeckElementPanel } from "../components/DeckElementPanel.js";
import { DeckLayerList } from "../components/DeckLayerList.js";
import { DeckSlideList } from "../components/DeckSlideList.js";
import { DeckToolbar } from "../components/DeckToolbar.js";
import {
  applyPositions,
  bringToFront,
  copyElements,
  copySlide,
  expandGroup,
  groupElements,
  insertSlideAfter,
  mapSlideElements,
  moveElementZ,
  newImageElement,
  newSlide,
  newTextElement,
  nudgeElements,
  patchElement,
  patchSlide,
  readSelection,
  removeElements,
  removeSlideAt,
  sendToBack,
  swapSlides,
  toggleSelection,
  ungroupElements,
} from "../lib/deckSlides.js";
import type {
  DeckElementCommands,
  DeckSlideCommands,
} from "../lib/deckSlides.js";
import { ensureDeckFonts } from "../lib/deckFonts.js";
import { useAutoSave } from "../lib/editor/useAutoSave.js";
import { useEditorHistory } from "../lib/editor/useEditorHistory.js";
import { useEditorKeyboard } from "../lib/editor/useEditorKeyboard.js";
import { useImagePicker } from "../lib/editor/useImagePicker.js";

/**
 * スライドの編集画面。
 *
 * ここが持つのは「いま何を編集しているか」（開いているページ・選んでいる要素）と、
 * 各部への結線だけ。中身を変える式は lib/deckSlides.ts に純粋な関数として置き、
 * 履歴・自動保存・キーボード・画像の差し込みは lib/editor/ にまとめてある
 * （ライブ配信セットの編集画面と同じ仕掛けなので、契約を2つ持たない）。
 */
export function DeckEditorPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: deck, isLoading, isError } = useDeck(id);
  const update = useUpdateDeck(id);
  const upload = useUploadDeckImage(id);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState<DeckContent | null>(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** 指で操作する端末向けの複数選択モード。ON の間はタップが追加選択になる */
  const [multiSelect, setMultiSelect] = useState(false);
  const loaded = useRef(false);

  const history = useEditorHistory<DeckContent>({
    content,
    setContent,
    // 戻した先に無い要素を選んだままにしない
    onRestore: () => setSelectedIds([]),
  });

  useEffect(() => {
    if (!deck || loaded.current) return;
    setTitle(deck.title);
    setContent(deck.content);
    history.reset(deck.content);
    // 使われている書体を先に読み込む。描いてから差し替わると位置がずれて見える
    ensureDeckFonts(deck.content);
    loaded.current = true;
    // history は ref だけを触るので、毎レンダの作り直しでは追わない
  }, [deck]);

  useAutoSave({
    ready: content !== null,
    deps: [content, title],
    onSave: () => {
      if (content) update.mutate({ title, content });
    },
  });

  const picker = useImagePicker(upload.mutateAsync);

  // ここから下は content が無い間も素通りできる形にしておく
  // （フックを早期 return より後ろに置けないため）
  const slides = content?.slides ?? [];
  const idx = Math.min(slideIdx, slides.length - 1);
  const slide: DeckSlide | undefined = slides[idx];
  const els = slide?.elements ?? [];
  const selection = readSelection(els, selectedIds);

  const editSlides = (fn: (s: DeckSlide[]) => DeckSlide[]) =>
    setContent((c) => (c ? { ...c, slides: fn(c.slides) } : c));
  const editEls = (fn: (arr: DeckElement[]) => DeckElement[]) =>
    editSlides((s) => mapSlideElements(s, idx, fn));

  const selectElement = (elId: string, additive: boolean) => {
    const members = expandGroup(els, elId);
    setSelectedIds(
      additive ? toggleSelection(selectedIds, members) : members,
    );
  };

  const addElement = (el: DeckElement) => {
    editEls((arr) => [...arr, el]);
    setSelectedIds([el.id]);
  };

  const slideCommands: DeckSlideCommands = {
    add: () => {
      editSlides((s) => insertSlideAfter(s, idx, newSlide()));
      setSlideIdx(idx + 1);
      setSelectedIds([]);
    },
    duplicate: () => {
      if (!slide) return;
      editSlides((s) => insertSlideAfter(s, idx, copySlide(slide)));
      setSlideIdx(idx + 1);
    },
    remove: () => {
      if (slides.length <= 1) return;
      editSlides((s) => removeSlideAt(s, idx));
      setSlideIdx(Math.max(0, idx - 1));
      setSelectedIds([]);
    },
    move: (d) => {
      const to = idx + d;
      if (to < 0 || to >= slides.length) return;
      editSlides((s) => swapSlides(s, idx, to));
      setSlideIdx(to);
    },
  };

  const elementCommands: DeckElementCommands = {
    patch: (elId, patch) => editEls((arr) => patchElement(arr, elId, patch)),
    remove: () => {
      if (selectedIds.length === 0) return;
      // 消したボタンからフォーカスが外れると画面が上へ跳ねるので、位置を戻す
      (document.activeElement as HTMLElement | null)?.blur?.();
      const y = window.scrollY;
      editEls((arr) => removeElements(arr, selectedIds));
      setSelectedIds([]);
      requestAnimationFrame(() => window.scrollTo(0, y));
    },
    duplicate: () => {
      if (selectedIds.length === 0) return;
      const copies = copyElements(els, selectedIds);
      editEls((arr) => [...arr, ...copies]);
      // 続けて動かせるよう、写した側に選択を移す
      setSelectedIds(copies.map((c) => c.id));
    },
    group: () => {
      if (selectedIds.length < 2) return;
      editEls((arr) => groupElements(arr, selectedIds));
    },
    ungroup: () => editEls((arr) => ungroupElements(arr, selectedIds)),
    toFront: () => editEls((arr) => bringToFront(arr, selectedIds)),
    toBack: () => editEls((arr) => sendToBack(arr, selectedIds)),
    moveZ: (elId, dir) => editEls((arr) => moveElementZ(arr, elId, dir)),
    nudge: (dx, dy) =>
      editEls((arr) => nudgeElements(arr, selectedIds, dx, dy)),
    moveTo: (moves) => editEls((arr) => applyPositions(arr, moves)),
  };

  useEditorKeyboard({
    undo: history.undo,
    redo: history.redo,
    hasSelection: selectedIds.length > 0,
    remove: elementCommands.remove,
    duplicate: elementCommands.duplicate,
    nudge: elementCommands.nudge,
    group: elementCommands.group,
    canGroup: selectedIds.length >= 2,
  });

  if (isError) return <Typography>{t("studio.deckNotFound")}</Typography>;
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
        <Button size="small" component={RouterLink} to="/decks">
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
          placeholder={t("studio.deckTitlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          sx={{ flex: 1, minWidth: 180 }}
        />
        <Typography variant="caption" color="text.secondary">
          {update.isPending ? t("studio.saving") : t("studio.autoSaved")}
        </Typography>
        {deck && (
          <Button
            size="small"
            variant="outlined"
            component={RouterLink}
            to={`/d/${deck.slug}`}
            target="_blank"
          >
            {t("studio.deckPublicViewer")}
          </Button>
        )}
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Stack spacing={1} sx={{ width: { md: 168 }, flexShrink: 0 }}>
          <DeckSlideList
            slides={slides}
            current={idx}
            onSelect={(j) => {
              setSlideIdx(j);
              setSelectedIds([]);
            }}
            commands={slideCommands}
          />
          <DeckLayerList
            els={els}
            selectedIds={selectedIds}
            multiSelect={multiSelect}
            onSelect={selectElement}
          />
        </Stack>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <DeckToolbar
            onAddText={() => addElement(newTextElement())}
            onAddImage={() =>
              picker.pick((url) => addElement(newImageElement(url)))
            }
            background={slide?.background ?? "#ffffff"}
            onBackgroundChange={(color) =>
              editSlides((s) => patchSlide(s, idx, { background: color }))
            }
            multiSelect={multiSelect}
            onToggleMultiSelect={() => setMultiSelect((m) => !m)}
          />
          <DeckCanvas
            slide={slide}
            selection={selection}
            multiSelect={multiSelect}
            commands={elementCommands}
            onSelect={selectElement}
            onSelectOnly={(elId) => setSelectedIds([elId])}
            onSelectNone={() => setSelectedIds([])}
          />
        </Box>

        <Stack spacing={1.5} sx={{ width: { md: 240 }, flexShrink: 0 }}>
          <DeckElementPanel
            selection={selection}
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

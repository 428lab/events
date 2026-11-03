import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Fab,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import RedoIcon from "@mui/icons-material/Redo";
import UndoIcon from "@mui/icons-material/Undo";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Deck, DeckContent, DeckElement, DeckSlide } from "@eventer/shared";
import { ApiError, api } from "../api/client.js";
import { relativeTime } from "../lib/format.js";
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
  copyElements,
  expandGroup,
  groupElements,
  newImageElement,
  newSlide,
  newTextElement,
  readSelection,
  toggleSelection,
  ungroupElements,
} from "../lib/deckSlides.js";
import {
  applyPositions,
  copyPage,
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
import type {
  DeckElementCommands,
  DeckSlideCommands,
} from "../lib/deckSlides.js";
import { ensureDeckFonts } from "../lib/deckFonts.js";
import { prepareLoadedContent, withDeckPositions } from "../lib/deckPositions.js";
import { useDeckSave } from "../lib/useDeckSave.js";
import { useDeckLeaveWarning } from "../lib/useDeckLeaveWarning.js";
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
    // 並びは位置キー pos が正。持たないもの（導入前・取り込み・AI が書いたもの）にだけ振る
    const initial = prepareLoadedContent(deck.content);
    setTitle(deck.title);
    setContent(initial);
    history.reset(initial);
    // 使われている書体を先に読み込む。描いてから差し替わると位置がずれて見える
    ensureDeckFonts(deck.content);
    loaded.current = true;
    // history は ref だけを触るので、毎レンダの作り直しでは追わない
  }, [deck]);

  // 保存は読み込んだ（最後に保存できた）版を添える。その間にほかのメンバー・別のタブ・AI が
  // 保存していたら 409 deck_conflict になり、自動保存はそこで止まる（黙って上書きしない）
  const baseRevision = useRef<number | undefined>(undefined);
  const [lastSaved, setLastSaved] = useState<{ name: string; at: number } | null>(null);
  useEffect(() => {
    if (!deck) return;
    if (baseRevision.current === undefined) baseRevision.current = deck.revision;
    if (lastSaved === null && deck.lastSavedBy) setLastSaved({ name: deck.lastSavedBy.name, at: deck.updatedAt });
  }, [deck]);
  const saveDeck = async (value: { title: string; content: DeckContent }) => {
    // 最後の守り: 配列の順と pos の順が食い違っていたら、配列の順から pos を振り直して送る
    const slidesToSave = withDeckPositions(value.content.slides);
    const contentToSave = slidesToSave === value.content.slides ? value.content : { ...value.content, slides: slidesToSave };
    const saved = await update.mutateAsync({ ...value, content: contentToSave, baseRevision: baseRevision.current });
    baseRevision.current = saved.revision;
    if (saved.lastSavedBy) setLastSaved({ name: saved.lastSavedBy.name, at: saved.updatedAt });
    return saved;
  };
  const saving = useDeckSave(title, content, saveDeck);
  const conflict = conflictOf(saving.error);
  const [copied, setCopied] = useState(false);
  const reloadLatest = async () => {
    const latest = await api.get<Deck>(`/decks/${id}`);
    const latestContent = prepareLoadedContent(latest.content);
    baseRevision.current = latest.revision;
    saving.reset(latest.title, latestContent);
    setTitle(latest.title);
    setContent(latestContent);
    history.reset(latestContent);
    setSelectedIds([]);
    setSlideIdx(0);
    setLastSaved(latest.lastSavedBy ? { name: latest.lastSavedBy.name, at: latest.updatedAt } : null);
    setCopied(false);
  };
  useDeckLeaveWarning(saving.revision > 0 && !saving.saved, t("deckImport.leave"));

  const picker = useImagePicker(upload.mutateAsync);

  // ここから下は content が無い間も素通りできる形にしておく
  // （フックを早期 return より後ろに置けないため）
  const slides = content?.slides ?? [];
  const idx = Math.min(slideIdx, slides.length - 1);
  const slide: DeckSlide | undefined = slides[idx];
  const els = slide?.elements ?? [];
  const selection = readSelection(els, selectedIds);

  // どの操作のあとも、配列の順に pos を合わせる（足した・写した・動かしたものだけ pos が変わる）。
  // 並べ替えは「動かしたものの pos を書き換える」になる（docs/team-deck-live-sync.md §5.2）
  const editSlides = (fn: (s: DeckSlide[]) => DeckSlide[]) =>
    setContent((c) => {
      if (!c) return c;
      const next = fn(c.slides);
      if (next === c.slides) return c;
      return { ...c, slides: withDeckPositions(next) };
    });
  const editEls = (fn: (arr: DeckElement[]) => DeckElement[]) =>
    editSlides((s) => mapElementsAt(s, idx, fn));

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
      editSlides((s) => insertAfter(s, idx, newSlide()));
      setSlideIdx(idx + 1);
      setSelectedIds([]);
    },
    duplicate: () => {
      if (!slide) return;
      editSlides((s) => insertAfter(s, idx, copyPage(slide)));
      setSlideIdx(idx + 1);
    },
    remove: () => {
      if (slides.length <= 1) return;
      editSlides((s) => removeAt(s, idx));
      setSlideIdx(Math.max(0, idx - 1));
      setSelectedIds([]);
    },
    move: (d) => {
      const to = idx + d;
      if (to < 0 || to >= slides.length) return;
      editSlides((s) => swapAt(s, idx, to));
      setSlideIdx(to);
    },
  };

  const elementCommands: DeckElementCommands = {
    patch: (elId, patch) => editEls((arr) => patchById(arr, elId, patch)),
    remove: () => {
      if (selectedIds.length === 0) return;
      // 消したボタンからフォーカスが外れると画面が上へ跳ねるので、位置を戻す
      (document.activeElement as HTMLElement | null)?.blur?.();
      const y = window.scrollY;
      editEls((arr) => removeByIds(arr, selectedIds));
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
    toFront: () => editEls((arr) => toFront(arr, selectedIds)),
    toBack: () => editEls((arr) => toBack(arr, selectedIds)),
    moveZ: (elId, dir) => editEls((arr) => moveZ(arr, elId, dir)),
    nudge: (dx, dy) =>
      editEls((arr) => nudgeByIds(arr, selectedIds, dx, dy)),
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
        <TextField
          size="small"
          placeholder={t("studio.deckTitlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          sx={{ flex: 1, minWidth: 180 }}
        />
        {deck?.team && <Chip size="small" color="primary" variant="outlined" label={t("studio.deckTeamLabel", { name: deck.team.name })} />}
        <Typography variant="caption" color="text.secondary">
          {/* ぶつかったときは「保存失敗。再ログイン…」ではなく「未保存」（理由は下の案内に出す） */}
          {t(`deckImport.${conflict ? "unsaved" : saving.status}`)}
          {deck?.team && lastSaved && !conflict && (
            <>{t("common.dotSeparator")}{t("studio.deckLastSaved", { name: lastSaved.name, time: relativeTime(lastSaved.at) })}</>
          )}
        </Typography>
        {saving.status === "editorFailed" && !conflict && <Button onClick={saving.retry}>{t("deckImport.editorRetry")}</Button>}
        {deck && (
          <Button
            size="small"
            variant="outlined"
            component={RouterLink}
            disabled={!saving.saved || upload.isPending}
            to={`/d/${deck.slug}`}
            target="_blank"
          >
            {t("studio.deckPublicViewer")}
          </Button>
        )}
      </Stack>

      {conflict && (
        <Alert severity="warning">
          <Stack spacing={1}>
            <Typography variant="body2">
              {conflict.name
                ? t("studio.deckConflict", { name: conflict.name, time: relativeTime(conflict.at) })
                : t("studio.deckConflictUnknown", { time: relativeTime(conflict.at) })}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button color="inherit" size="small" variant="outlined" onClick={() => void reloadLatest()}>
                {t("studio.deckConflictReload")}
              </Button>
              <Button color="inherit" size="small" onClick={() => {
                void navigator.clipboard?.writeText(JSON.stringify({ title, content }, null, 2)).then(() => setCopied(true));
              }}>
                {copied ? t("studio.deckConflictCopied") : t("studio.deckConflictCopy")}
              </Button>
            </Stack>
          </Stack>
        </Alert>
      )}

      <Typography variant="caption">{t("deckImport.tabs")}</Typography>
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
              editSlides((s) => patchAt(s, idx, { background: color }))
            }
            multiSelect={multiSelect}
            onToggleMultiSelect={() => setMultiSelect((m) => !m)}
            onUndo={history.undo}
            onRedo={history.redo}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
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

/** 保存の失敗が「ほかの人が保存していた」(409 deck_conflict) なら、誰がいつ保存したか */
function conflictOf(error: unknown): { name: string | null; at: number } | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = error.body as { error?: string; updatedAt?: number; lastSavedBy?: { name: string } | null } | null;
  if (body?.error !== "deck_conflict") return null;
  return { name: body.lastSavedBy?.name ?? null, at: body.updatedAt ?? Date.now() };
}

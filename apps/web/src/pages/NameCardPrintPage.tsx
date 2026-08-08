import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  GlobalStyles,
  LinearProgress,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import PrintIcon from "@mui/icons-material/Print";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  CARDS_PER_SHEET,
  NAME_CARD_H_MM,
  NAME_CARD_W_MM,
  SHEET_COLS,
  SHEET_H_MM,
  SHEET_MARGIN_X_MM,
  SHEET_MARGIN_Y_MM,
  SHEET_W_MM,
} from "@eventer/shared";
import type { EventNameCard, EventRole } from "@eventer/shared";
import { useEvent } from "../api/hooks.js";
import { useEventNameCards } from "../api/nameCardHooks.js";
import {
  BG_STORAGE_KEY,
  BG_VARIANTS,
  CARD_THEMES,
  LicenseCardSvg,
  THEME_STORAGE_KEY,
  toCardData,
} from "../components/licenseCard/LicenseCardSvg.js";
import type {
  CardBgVariant,
  CardThemeKey,
} from "../components/licenseCard/LicenseCardSvg.js";

/**
 * 名札の一括印刷 (#304)。
 *
 * オフラインイベントで毎回発生する「参加者ぶんの名札を用意する」作業を、
 * 既にあるプロフィールカード (#178) をそのまま並べて済ませられるようにする。
 * A4に10面（2列×5行・91×55mm）で、市販の名刺用紙・名札ケースに合う面付け。
 *
 * 見た目は既存カードのまま。この画面が足すのは「誰を刷るか」の選択と面付けだけ。
 */

const ROLE_LABEL: Record<EventRole, string> = {
  participant: "参加者",
  staff: "スタッフ",
  judge: "審査員",
  observer: "観覧者",
};

/** 一度に描き足す枚数。100人規模でも入力が固まらないよう小分けにする */
const RENDER_STEP = 6;

function loadBgVariant(): CardBgVariant {
  const saved = localStorage.getItem(BG_STORAGE_KEY);
  return BG_VARIANTS.some((v) => v.key === saved)
    ? (saved as CardBgVariant)
    : "rosette";
}

function loadCardTheme(): CardThemeKey {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return CARD_THEMES.some((t) => t.key === saved)
    ? (saved as CardThemeKey)
    : "indigo";
}

/** 10枚ずつのページに割る（A4 1枚分＝10面） */
export function toSheets<T>(cards: T[], perSheet = CARDS_PER_SHEET): T[][] {
  const sheets: T[][] = [];
  for (let i = 0; i < cards.length; i += perSheet) {
    sheets.push(cards.slice(i, i + perSheet));
  }
  return sheets;
}

/** 印刷用スタイル。用紙に出るのはカードだけで、共通ヘッダーもこの画面の操作UIも刷らない。
 *
 * 隠すものは visibility ではなく display で消す。visibility だけだと隠した要素が
 * 高さを持ったまま残り、1枚目の用紙がその分ずり下がって面付けが狂うため。
 * 用紙は通常フローのまま置き、改ページは break-after: page に任せる
 * （position: absolute にすると改ページ指定が効かないブラウザがある）。
 *
 * 面付けはA4に等間隔で敷き詰める＝左右14mm・上下11mmの余白（名刺用紙の10面と同じ） */
function PrintStyles() {
  return (
    <GlobalStyles
      styles={{
        "@media print": {
          "@page": { size: "A4 portrait", margin: 0 },
          html: { background: "#fff" },
          body: { background: "#fff", margin: 0, padding: 0 },
          // 共通ヘッダー・操作UI・重なり系（ダイアログ等）は刷らない
          [[
            ".MuiAppBar-root",
            ".name-card-controls",
            ".MuiSnackbar-root",
            ".MuiDialog-root",
            ".MuiPopover-root",
            ".MuiTooltip-popper",
          ].join(",")]: { display: "none !important" },
          // 用紙を用紙の左上から始めるため、外側の余白と幅制限を外す
          ".MuiContainer-root": {
            maxWidth: "none !important",
            margin: "0 !important",
            padding: "0 !important",
          },
          ".name-card-page": {
            maxWidth: "none !important",
            margin: "0 !important",
          },
          "#name-card-sheets": {
            margin: "0 !important",
            padding: 0,
            gap: "0 !important",
          },
          // 背景パターンや紙面グラデーションを落とさずに刷る
          ".name-card-sheet": {
            border: "none !important",
            boxShadow: "none !important",
            margin: "0 !important",
            breakAfter: "page",
            pageBreakAfter: "always",
            printColorAdjust: "exact",
            WebkitPrintColorAdjust: "exact",
          },
          // 最後の1枚のあとに空白ページを作らない
          ".name-card-sheet:last-of-type": {
            breakAfter: "auto",
            pageBreakAfter: "auto",
          },
          ".name-card-cell": { breakInside: "avoid", pageBreakInside: "avoid" },
        },
      }}
    />
  );
}

/** A4 1枚分（10面）。画面でも同じ寸法で出して、刷り上がりと見比べられるようにする */
function Sheet({
  cards,
  variant,
  theme,
  origin,
  host,
}: {
  cards: EventNameCard[];
  variant: CardBgVariant;
  theme: CardThemeKey;
  origin: string;
  host: string;
}) {
  return (
    <Box
      className="name-card-sheet"
      // 面付けの寸法はテーマに左右されない印刷の実寸なので、そのまま style に置く
      style={{
        width: `${SHEET_W_MM}mm`,
        height: `${SHEET_H_MM}mm`,
        boxSizing: "border-box",
        padding: `${SHEET_MARGIN_Y_MM}mm ${SHEET_MARGIN_X_MM}mm`,
        display: "grid",
        gridTemplateColumns: `repeat(${SHEET_COLS}, ${NAME_CARD_W_MM}mm)`,
        gridAutoRows: `${NAME_CARD_H_MM}mm`,
        background: "#fff",
        marginLeft: "auto",
        marginRight: "auto",
      }}
      // 画面では用紙の輪郭が分かるように（印刷では PrintStyles が消す）
      sx={{ border: "1px solid", borderColor: "divider" }}
    >
      {cards.map((c) => (
        <Box
          key={c.id}
          className="name-card-cell"
          style={{
            width: `${NAME_CARD_W_MM}mm`,
            height: `${NAME_CARD_H_MM}mm`,
            overflow: "hidden",
          }}
          sx={{
            "& svg": {
              width: `${NAME_CARD_W_MM}mm`,
              height: `${NAME_CARD_H_MM}mm`,
              display: "block",
            },
          }}
        >
          <LicenseCardSvg
            card={toCardData(c, c.handle, host)}
            variant={variant}
            theme={theme}
            qrUrl={`${origin}/users/${c.handle}?ref=card`}
          />
        </Box>
      ))}
    </Box>
  );
}

export function NameCardPrintPage() {
  const { id = "" } = useParams();
  const { data: eventData, isLoading: eventLoading } = useEvent(id);
  // イベント配下の画面はサイト管理者かどうかを混ぜず、イベント内の役割だけで判定する
  const isStaff = eventData?.myRole === "staff";
  const {
    data,
    isLoading,
    isError,
  } = useEventNameCards(id, Boolean(eventData) && isStaff);

  const [variant] = useState<CardBgVariant>(loadBgVariant);
  const [theme] = useState<CardThemeKey>(loadCardTheme);
  /** 印刷から外した人。既定は全員選択なので「外した人」を持つほうが素直 */
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  /** 何枚まで描いたか。100人規模で一度に描くと固まるので少しずつ増やす */
  const [rendered, setRendered] = useState(0);

  const all = useMemo(() => data?.cards ?? [], [data]);
  const selected = useMemo(
    () => all.filter((c) => !excluded.has(c.id)),
    [all, excluded],
  );

  // 描画枚数を少しずつ増やす（減る方向には戻さない＝チェックを外しても描き直しにしない）
  const target = selected.length;
  useEffect(() => {
    if (rendered >= target) return;
    const timer = window.setTimeout(
      () => setRendered((n) => Math.min(n + RENDER_STEP, target)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [rendered, target]);

  const visible = useMemo(
    () => selected.slice(0, Math.max(rendered, 0)),
    [selected, rendered],
  );
  const ready = visible.length === selected.length;

  const origin = useRef(window.location.origin).current;
  const host = useRef(window.location.host).current;
  const sheets = useMemo(() => toSheets(visible), [visible]);

  const toggle = (userId: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  if (eventLoading) return <Typography>読み込み中…</Typography>;
  if (!isStaff) {
    return (
      <Alert severity="info">
        この画面はイベントのスタッフだけが使えます。
      </Alert>
    );
  }
  if (isError) {
    return <Alert severity="error">名札の情報を取得できませんでした。</Alert>;
  }

  return (
    <Box className="name-card-page" sx={{ maxWidth: 1100, mx: "auto" }}>
      <PrintStyles />
      <Stack spacing={2} className="name-card-controls">
        <Box>
          <Typography variant="h5" fontWeight={700}>
            名札の印刷
          </Typography>
          <Typography variant="caption" color="text.secondary">
            A4に10面（91×55mm）で並べます。市販の名刺用紙や名札ケースに合う大きさです
            {" ・ "}
            <Link component={RouterLink} to={`/events/${id}`}>
              イベントへ戻る
            </Link>
          </Typography>
        </Box>

        {isLoading && <CircularProgress size={24} />}

        {!isLoading && all.length === 0 && (
          <Alert severity="info">
            参加が確定しているメンバーがまだいません。
          </Alert>
        )}

        {all.length > 0 && (
          <>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Typography variant="body2">
                {selected.length} 人 / {all.length} 人（A4 {sheets.length} 枚）
              </Typography>
              <Button size="small" onClick={() => setExcluded(new Set())}>
                すべて選ぶ
              </Button>
              <Button
                size="small"
                onClick={() => setExcluded(new Set(all.map((c) => c.id)))}
              >
                すべて外す
              </Button>
              <Button
                variant="contained"
                startIcon={<PrintIcon />}
                disabled={selected.length === 0 || !ready}
                onClick={() => window.print()}
              >
                印刷する
              </Button>
            </Stack>

            {!ready && (
              <Box>
                <LinearProgress
                  variant="determinate"
                  value={
                    selected.length
                      ? (visible.length / selected.length) * 100
                      : 0
                  }
                />
                <Typography variant="caption" color="text.secondary">
                  カードを作成しています（{visible.length} / {selected.length}）
                </Typography>
              </Box>
            )}

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                印刷する人
              </Typography>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "1fr 1fr",
                    md: "1fr 1fr 1fr",
                  },
                  gap: 0.5,
                }}
              >
                {all.map((c) => (
                  <FormControlLabel
                    key={c.id}
                    control={
                      <Checkbox
                        size="small"
                        checked={!excluded.has(c.id)}
                        onChange={() => toggle(c.id)}
                        inputProps={{
                          "aria-label": `${c.name} を印刷する`,
                        }}
                      />
                    }
                    label={
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        sx={{ minWidth: 0 }}
                      >
                        <Avatar
                          src={c.avatarUrl ?? undefined}
                          sx={{ width: 24, height: 24 }}
                        >
                          {[...c.name][0] ?? "?"}
                        </Avatar>
                        <Typography variant="body2" noWrap>
                          {c.name}
                        </Typography>
                        {c.role !== "participant" && (
                          <Chip size="small" label={ROLE_LABEL[c.role]} />
                        )}
                      </Stack>
                    }
                  />
                ))}
              </Box>
            </Box>

            <Typography variant="subtitle2">
              刷り上がりのプレビュー
            </Typography>
            <Typography variant="caption" color="text.secondary">
              背景の色を出すには、印刷ダイアログで「背景のグラフィック」を有効にしてください
            </Typography>
          </>
        )}
      </Stack>

      {/* 用紙そのもの。印刷ではこれだけが出る */}
      <Stack id="name-card-sheets" spacing={2} sx={{ mt: 2, overflowX: "auto" }}>
        {sheets.map((cards, i) => (
          <Sheet
            key={i}
            cards={cards}
            variant={variant}
            theme={theme}
            origin={origin}
            host={host}
          />
        ))}
      </Stack>
    </Box>
  );
}

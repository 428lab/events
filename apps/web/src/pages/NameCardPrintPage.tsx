import { memo, useEffect, useMemo, useRef, useState } from "react";
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
  NAME_CARD_GAP_MM,
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
  LicenseCardSvg,
  toCardData,
} from "../components/licenseCard/LicenseCardSvg.js";
import type {
  CardBgVariant,
  CardThemeKey,
} from "../components/licenseCard/LicenseCardSvg.js";
import {
  cardLook,
  loadLocalCardLook,
} from "../components/licenseCard/cardLook.js";

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

/** 10枚ずつのページに割る（A4 1枚分＝10面） */
export function toSheets<T>(cards: T[], perSheet = CARDS_PER_SHEET): T[][] {
  const sheets: T[][] = [];
  for (let i = 0; i < cards.length; i += perSheet) {
    sheets.push(cards.slice(i, i + perSheet));
  }
  return sheets;
}

/** 印刷では消す要素。共通ヘッダー・この画面の操作UI・重なり系（ダイアログ等）に加え、
 * 共通フッター（Layout では Container の外にいる）も含める。フッターが残ると最後の
 * 用紙のあとに流れて、リンクとバージョンだけが刷られた紙が1枚余分に出る */
export const HIDDEN_IN_PRINT = [
  ".MuiAppBar-root",
  ".name-card-controls",
  ".version-footer",
  ".MuiSnackbar-root",
  ".MuiDialog-root",
  ".MuiPopover-root",
  ".MuiTooltip-popper",
];

/** 印刷用スタイル。用紙に出るのはカードだけで、共通ヘッダーもこの画面の操作UIも刷らない。
 *
 * 隠すものは visibility ではなく display で消す。visibility だけだと隠した要素が
 * 高さを持ったまま残り、1枚目の用紙がその分ずり下がって面付けが狂うため。
 * 用紙は通常フローのまま置き、改ページは break-after: page に任せる
 * （position: absolute にすると改ページ指定が効かないブラウザがある）。
 *
 * 面付けはA4に等間隔で敷き詰める＝左右14mm・上下11mmの余白（名刺用紙の10面と同じ） */
export const PRINT_STYLES = {
  "@media print": {
    "@page": { size: "A4 portrait", margin: 0 },
    html: { background: "#fff" },
    body: { background: "#fff", margin: 0, padding: 0 },
    [HIDDEN_IN_PRINT.join(",")]: { display: "none !important" },
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
      // 画面では横スクロールさせるが、印刷では必ず外す。overflow が visible 以外だと
      // 分割できないボックスになり、中身が用紙に収まっていても末尾に白紙が1枚増える
      overflow: "visible !important",
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
} as const;

function PrintStyles() {
  return <GlobalStyles styles={PRINT_STYLES} />;
}

/** 名札1枚ぶんのセル。
 *
 * カードは6枚ずつ描き足していくので、memo が無いと1バッチごとに既に描いた分まで
 * 全部描き直しになる（100人なら延べ900枚ぶん）。カード1枚のQRだけで矩形が551個あり、
 * 実測できるほど重い。card は react-query が返す配列の要素で参照が変わらず、
 * 残りの props も文字列なので、既定の浅い比較でそのまま止められる。
 * toCardData() は毎回新しいオブジェクトを返すため、memo の内側で作る。
 *
 * カードSVG内の id（グラデーション・clipPath）は固定値なので、100枚並べると同じ id が
 * 並ぶ。今は全カードが同じテーマ＝同じ定義なのでどれを参照しても結果が変わらず問題ないが、
 * カードごとにテーマや背景を変えられるようにするなら、id をカード単位で一意にしないと
 * すべてのカードが先頭カードの色で描かれる。 */
const NameCardCell = memo(function NameCardCell({
  card,
  variant,
  theme,
  origin,
  host,
}: {
  card: EventNameCard;
  variant: CardBgVariant;
  theme: CardThemeKey;
  origin: string;
  host: string;
}) {
  const data = useMemo(
    () => toCardData(card, card.handle, host),
    [card, host],
  );
  return (
    <Box
      className="name-card-cell"
      // カードSVGは幅いっぱい（91mm）に伸ばす。1074:650 の比なので高さは 55.07mm となり、
      // はみ出す 0.07mm はここで切る。用紙側の面付けを 55mm ちょうどに保つため
      style={{
        width: `${NAME_CARD_W_MM}mm`,
        height: `${NAME_CARD_H_MM}mm`,
        overflow: "hidden",
      }}
    >
      <LicenseCardSvg
        card={data}
        variant={variant}
        theme={theme}
        qrUrl={`${origin}/users/${card.handle}?ref=card`}
      />
    </Box>
  );
});

/** A4 1枚分（10面）。画面でも同じ寸法で出して、刷り上がりと見比べられるようにする。
 *
 * toSheets() は描き足すたびに新しい配列を返すので、中身が同じでも参照だけが変わる。
 * 既に埋まった用紙をそのまま素通りさせるため、カードの並びを1枚ずつ比べて判定する */
const Sheet = memo(SheetInner, (a, b) => {
  if (
    a.variant !== b.variant ||
    a.theme !== b.theme ||
    a.origin !== b.origin ||
    a.host !== b.host ||
    a.cards.length !== b.cards.length
  ) {
    return false;
  }
  return a.cards.every((c, i) => c === b.cards[i]);
});

function SheetInner({
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
        // 切り離しやすいようカードどうしを少しあける（余白は定数側で調整済み）
        gap: `${NAME_CARD_GAP_MM}mm`,
        background: "#fff",
        marginLeft: "auto",
        marginRight: "auto",
      }}
      // 画面では用紙の輪郭が分かるように（印刷では PrintStyles が消す）
      sx={{ border: "1px solid", borderColor: "divider" }}
    >
      {cards.map((c) => {
        // 本人が決めた見た目で刷る。未設定の人だけ刷る人の設定を借りる
        const look = cardLook(c.cardImageKey, { variant, theme });
        return (
          <NameCardCell
            key={c.id}
            card={c}
            variant={look.variant}
            theme={look.theme}
            origin={origin}
            host={host}
          />
        );
      })}
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

  // 一度もカードを保存していない人にだけ使う、刷る人の手元の既定
  const [{ variant, theme }] = useState(loadLocalCardLook);
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
  // 名簿が届く前は selected も visible も 0 で「描き終わった」ことになってしまうので、
  // 読み込み中は未完了として扱う（進捗バーが一瞬消えてまた出るのを防ぐ）
  const ready = !isLoading && visible.length === selected.length;

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

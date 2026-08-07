import { useRef, useState } from "react";
import { ClickAwayListener, IconButton, Tooltip } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";

/**
 * 定義・計算式を出すⓘ。数字より説明が場所を取って一覧性が落ちるため、
 * 常時表示をやめてここに畳む（内容は削らない）。
 *
 * MUI の既定リスナーは使わず自前で開閉する。既定のままだと、タップ時に
 * touch/hover で開いた直後に click が続けて発火してトグルで閉じてしまい、
 * モバイルで開けない。ポインタ種別を見て「マウスならホバー、指ならタップ」に
 * 振り分ける。キーボードは :focus-visible のときだけ開く（マウスクリックの
 * フォーカスで二重に発火させない）。
 */
export function InfoTip({
  label,
  text,
  size = 15,
}: {
  /** 何の説明かを読み上げに出すためのラベル（見出しやタイル名） */
  label: string;
  text: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  /** マウスのホバーで開いている間は click でトグルしない（開いた直後に閉じないように） */
  const hovering = useRef(false);
  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Tooltip
        title={text}
        open={open}
        // ボタン自身の名前は aria-label で持つので、中身は説明（aria-describedby）
        // として読ませる。キーボードで来たときは開くので読み上げに乗る
        describeChild
        disableHoverListener
        disableFocusListener
        disableTouchListener
        placement="top"
        arrow
        slotProps={{
          tooltip: {
            sx: { fontSize: 12, lineHeight: 1.7, maxWidth: 340, p: 1.25 },
          },
        }}
      >
        <IconButton
          size="small"
          aria-label={`${label}の説明`}
          onClick={() => {
            if (!hovering.current) setOpen((v) => !v);
          }}
          onPointerEnter={(e) => {
            if (e.pointerType !== "mouse") return;
            hovering.current = true;
            setOpen(true);
          }}
          onPointerLeave={(e) => {
            if (e.pointerType !== "mouse") return;
            hovering.current = false;
            setOpen(false);
          }}
          onFocus={(e) => {
            if (e.currentTarget.matches(":focus-visible")) setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          sx={{
            p: 0.25,
            flexShrink: 0,
            color: "text.disabled",
            "&:hover, &:focus-visible": { color: "text.secondary" },
          }}
        >
          <InfoOutlinedIcon sx={{ fontSize: size }} />
        </IconButton>
      </Tooltip>
    </ClickAwayListener>
  );
}

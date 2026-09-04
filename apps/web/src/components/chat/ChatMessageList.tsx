import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  Box,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ConstructionOutlinedIcon from "@mui/icons-material/ConstructionOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Event as NostrEvent } from "nostr-tools/pure";
import type { ChatMember } from "@eventer/shared";
import { formatChatTime } from "../../lib/chatTime.js";
import { ImageLightbox } from "../ImageLightbox.js";
import { ChatMessageBody } from "./ChatMessageBody.js";

/** 投影用のサイズ (#215)。プロジェクターやウィンドウキャプチャで読める大きさ。
 * 通常の画面では従来どおり MUI の既定に任せる（undefined を返す） */
export function chatFontSizes(display: boolean, fontScale: number) {
  return {
    body: display ? `${1.5 * fontScale}rem` : undefined,
    name: display ? `${1 * fontScale}rem` : undefined,
    avatar: display ? Math.round(44 * fontScale) : 28,
    staffIcon: display ? 20 * fontScale : 14,
  };
}

/**
 * メッセージ一覧 (#199 / #215 / #228 / #241)。
 *
 * 描画だけを持ち、誰の発言を出すか（許可リスト・非表示・件数の上限）は
 * 呼び出し側が決めて `messages` に入れて渡す。
 * スタッフ用の操作は `showStaffActions` でだけ出す
 * （`myRole` をここに持ち込むと投影用画面に漏れる #215）。
 */
export function ChatMessageList({
  messages,
  memberByPubkey,
  display,
  fontScale,
  fullHeight,
  urlsAllowed,
  showStaffActions,
  hidePending,
  onHide,
}: {
  messages: NostrEvent[];
  memberByPubkey: Map<string, ChatMember>;
  /** 投影用画面か (#215) */
  display: boolean;
  fontScale: number;
  /** 親のflex列の残り高さいっぱいに広げるか（専用ページ・投影用） */
  fullHeight: boolean;
  /** URL のリンク化・画像化を全員に許すか（スタッフの発言は常に許す #241） */
  urlsAllowed: boolean;
  showStaffActions: boolean;
  hidePending: boolean;
  onHide: (noteId: string) => void;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  // タップで拡大表示中のインライン画像URL (#241)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const size = chatFontSizes(display, fontScale);

  // 新着メッセージで最下部へ自動スクロール
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <Box
      ref={listRef}
      sx={{
        ...(fullHeight ? { flex: 1, minHeight: 0 } : { maxHeight: 360 }),
        overflowY: "auto",
        pr: 0.5,
      }}
    >
      {messages.length === 0 ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontSize: size.body }}
        >
          {display
            ? t("eventSocial.chatEmptyDisplay")
            : t("eventSocial.chatEmpty")}
        </Typography>
      ) : (
        <Stack spacing={display ? 2 : 1.25}>
          {messages.map((m) => {
            const member = memberByPubkey.get(m.pubkey);
            if (!member) return null;
            return (
              <Stack
                key={m.id}
                direction="row"
                spacing={display ? 1.5 : 1}
                alignItems="flex-start"
              >
                <Avatar
                  src={member.avatarUrl ?? undefined}
                  component={RouterLink}
                  to={`/users/${member.username}`}
                  sx={{
                    width: size.avatar,
                    height: size.avatar,
                    fontSize: display ? size.avatar * 0.45 : 13,
                    textDecoration: "none",
                  }}
                >
                  {member.name.charAt(0)}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} alignItems="baseline">
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      noWrap
                      component={RouterLink}
                      to={`/users/${member.username}`}
                      sx={{
                        // スタッフの発言は色分け (#228)
                        color:
                          member.role === "staff"
                            ? "secondary.main"
                            : "inherit",
                        textDecoration: "none",
                        "&:hover": { textDecoration: "underline" },
                        fontSize: size.name,
                      }}
                    >
                      {member.name}
                    </Typography>
                    {/* 立場の名前は `role` の表
                        (i18n/messages/labels.ts) が source。
                        ここに書き写さない */}
                    {member.role === "staff" && (
                      <Tooltip title={t("role.staff")}>
                        <ConstructionOutlinedIcon
                          sx={{
                            fontSize: size.staffIcon,
                            color: "secondary.main",
                            alignSelf: "center",
                          }}
                        />
                      </Tooltip>
                    )}
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontSize: size.name }}
                    >
                      {formatChatTime(m.created_at)}
                    </Typography>
                  </Stack>
                  {/* Markdown/HTML は解釈しない。URLのリンク化・画像化は
                      スタッフの発言か、URL投稿が許可されたイベントのみ (#241) */}
                  <ChatMessageBody
                    content={m.content}
                    linkify={member.role === "staff" || urlsAllowed}
                    onOpenImage={setLightboxUrl}
                    fontSize={size.body}
                  />
                </Box>
                {showStaffActions && (
                  <Tooltip title={t("eventSocial.chatHideMessage")}>
                    <IconButton
                      size="small"
                      disabled={hidePending}
                      onClick={() => {
                        if (
                          window.confirm(t("eventSocial.chatHideMessageConfirm"))
                        ) {
                          onHide(m.id);
                        }
                      }}
                    >
                      <VisibilityOffOutlinedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            );
          })}
        </Stack>
      )}
      <ImageLightbox
        src={lightboxUrl ?? ""}
        open={lightboxUrl !== null}
        onClose={() => setLightboxUrl(null)}
      />
    </Box>
  );
}

import { useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { MAX_EVENT_COHOSTS } from "@eventer/shared";
import type { Community, EventCohost } from "@eventer/shared";
import { useEventCohosts, useRemoveCohost, useRequestCohost } from "../api/cohostHooks.js";
import { useCommunities, useMyCommunities } from "../api/communityHooks.js";
import { errorMessage } from "../lib/errorMessage.js";

/** 共催の候補。own は自分が owner/admin のコミュニティ（追加するとすぐ共催になる） */
export interface CohostCandidate {
  id: string;
  slug: string;
  name: string;
  iconUrl: string | null;
  own: boolean;
}

/** 検索欄に貼られた「https://…/c/foo/」や「/c/foo」を slug に直す（サーバーの toSlug と同じ形）。
 * 直せない文字列はそのまま小文字にして返す */
export function cohostQueryToSlug(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/?c\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** 自分が管理するコミュニティを先に、そのほかは公開一覧の順で並べる。
 * 主催コミュニティと、承認待ち・共催中のコミュニティは出さない */
export function cohostCandidates(
  mine: Community[],
  all: Community[],
  exclude: Set<string>,
): CohostCandidate[] {
  const toCandidate = (c: Community, own: boolean): CohostCandidate => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    iconUrl: c.iconUrl,
    own,
  });
  const mineIds = new Set(mine.map((c) => c.id));
  return [
    ...mine.filter((c) => !exclude.has(c.id)).map((c) => toCandidate(c, true)),
    ...all.filter((c) => !exclude.has(c.id) && !mineIds.has(c.id)).map((c) => toCandidate(c, false)),
  ];
}

/** 名前・slug の部分一致。URL を貼られたときは slug に直して完全一致も見る */
function filterCandidates(options: CohostCandidate[], query: string): CohostCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const slug = cohostQueryToSlug(query);
  return options.filter(
    (o) => o.slug === slug || o.name.toLowerCase().includes(q) || o.slug.includes(q),
  );
}

/** 共催コミュニティ (#625)。運営ページの「その場で管理」に出す。
 *
 * 追加はコミュニティの一覧から選ぶ（名前・slug で絞り込める）。自分が owner/admin の
 * コミュニティは先頭に「すぐ共催」として並び、選ぶと承認なしで共催中になる。そのほかの
 * コミュニティは相手の owner/admin への依頼になり、承認されて初めて共催になる。
 * 一覧に無いものは検索欄に URL か slug を入れて Enter で依頼できる（予備の手段）。
 * 共催は表示と一覧掲載だけで権限は付かない（補足文で明示する）。 */
export function EventCohostsCard({
  eventId,
  hostCommunityId,
}: {
  eventId: string;
  hostCommunityId: string | null;
}) {
  const { t } = useTranslation();
  const { data: cohosts } = useEventCohosts(eventId, true);
  const { data: mine } = useMyCommunities();
  const { data: all } = useCommunities();
  const request = useRequestCohost(eventId);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ name: string; accepted: boolean } | null>(null);
  const full = (cohosts?.length ?? 0) >= MAX_EVENT_COHOSTS;

  const candidates = useMemo(() => {
    const exclude = new Set(cohosts?.map((c) => c.communityId) ?? []);
    if (hostCommunityId) exclude.add(hostCommunityId);
    return cohostCandidates(mine ?? [], all ?? [], exclude);
  }, [cohosts, mine, all, hostCommunityId]);

  const send = (slug: string, name: string) => {
    setError("");
    setDone(null);
    request.mutate(slug, {
      onSuccess: (data) => {
        setQuery("");
        setDone({ name, accepted: data.status === "accepted" });
      },
      onError: (e) =>
        setError(
          errorMessage(e, {
            default: t("cohost.errorDefault"),
            community_not_found: t("cohost.errorCommunityNotFound"),
            host_community: t("cohost.errorHostCommunity"),
            already_cohost: t("cohost.errorAlreadyCohost"),
            cohost_limit: t("cohost.errorLimit", { n: MAX_EVENT_COHOSTS }),
          }),
        ),
    });
  };

  /** 検索欄で Enter。候補が1つに絞れていればそれを、無ければ入力を URL か slug として送る */
  const sendQuery = () => {
    const text = query.trim();
    if (!text) return;
    const matches = filterCandidates(candidates, text);
    const exact = matches.find((o) => o.slug === cohostQueryToSlug(text));
    const pick = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (pick) send(pick.slug, pick.name);
    else send(text, cohostQueryToSlug(text));
  };

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {t("cohost.manageIntro")}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("cohost.manageHowTo")}
      </Typography>
      <Autocomplete<CohostCandidate, false, false, true>
        freeSolo
        openOnFocus
        size="small"
        options={candidates}
        disabled={full || request.isPending}
        value={null}
        inputValue={query}
        onInputChange={(_, v, reason) => {
          if (reason !== "reset") setQuery(v);
        }}
        onChange={(_, v, reason) => {
          if (v && typeof v !== "string") send(v.slug, v.name);
          else if (reason === "createOption") sendQuery();
        }}
        filterOptions={(options, state) => filterCandidates(options, state.inputValue)}
        groupBy={(o) => t(o.own ? "cohost.groupOwn" : "cohost.groupOther")}
        getOptionLabel={(o) => (typeof o === "string" ? o : o.name)}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        noOptionsText={t("cohost.pickerNoMatch")}
        renderOption={(props, o) => {
          const { key: _key, ...rest } = props as typeof props & { key?: string };
          return (
            <Box component="li" {...rest} key={o.id} data-testid="cohost-candidate">
              <Avatar
                src={o.iconUrl ?? undefined}
                variant="rounded"
                sx={{ width: 28, height: 28, fontSize: 14, borderRadius: "6px", mr: 1, flexShrink: 0 }}
              >
                {o.name.charAt(0)}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap data-testid="cohost-candidate-name">
                  {o.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  /c/{o.slug}
                </Typography>
              </Box>
              <Chip
                size="small"
                sx={{ ml: 1, flexShrink: 0 }}
                color={o.own ? "success" : "default"}
                variant="outlined"
                label={t(o.own ? "cohost.optionInstant" : "cohost.optionRequest")}
              />
            </Box>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={t("cohost.pickerLabel")}
            placeholder={t("cohost.pickerPlaceholder")}
            InputLabelProps={{ ...params.InputLabelProps, shrink: true }}
          />
        )}
      />
      <Typography variant="caption" color="text.secondary">
        {t("cohost.pickerHelp")}
      </Typography>
      {full && (
        <Typography variant="body2" color="text.secondary">
          {t("cohost.limitReached", { n: MAX_EVENT_COHOSTS })}
        </Typography>
      )}
      {done && (
        <Alert severity="success" onClose={() => setDone(null)}>
          {t(done.accepted ? "cohost.addedInstant" : "cohost.addedRequest", { name: done.name })}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {!cohosts || cohosts.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("cohost.manageEmpty")}
        </Typography>
      ) : (
        <Stack spacing={1}>
          {cohosts.map((cohost) => (
            <CohostRow key={cohost.communityId} eventId={eventId} cohost={cohost} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function CohostRow({ eventId, cohost }: { eventId: string; cohost: EventCohost }) {
  const { t } = useTranslation();
  // 行ごとに持つ（1件を外している間に他の行のボタンまで止めないため）
  const remove = useRemoveCohost(eventId);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const pending = cohost.status === "pending";

  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Avatar
          src={cohost.iconUrl ?? undefined}
          variant="rounded"
          sx={{ width: 28, height: 28, fontSize: 14, borderRadius: "6px" }}
        >
          {cohost.name.charAt(0)}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {cohost.name}{" "}
            <Typography component="span" variant="caption" color="text.secondary">
              /c/{cohost.slug}
            </Typography>
          </Typography>
        </Box>
        <Chip
          size="small"
          color={pending ? "warning" : "success"}
          variant={pending ? "filled" : "outlined"}
          label={t(pending ? "cohost.statusPending" : "cohost.statusAccepted")}
        />
        <Chip
          size="small"
          label={t("cohost.remove")}
          clickable
          disabled={remove.isPending}
          onClick={() => setConfirming(true)}
        />
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mt: 0.5 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      <Dialog open={confirming} onClose={() => setConfirming(false)}>
        <DialogTitle>{t("cohost.removeConfirmTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t("cohost.removeConfirmBody", { name: cohost.name })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>{t("common.cancel")}</Button>
          <Button
            color="error"
            disabled={remove.isPending}
            onClick={() => {
              setError("");
              remove.mutate(cohost.communityId, {
                onSuccess: () => setConfirming(false),
                onError: (e) => {
                  setConfirming(false);
                  setError(errorMessage(e, { default: t("cohost.actionError") }));
                },
              });
            }}
          >
            {t("cohost.remove")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

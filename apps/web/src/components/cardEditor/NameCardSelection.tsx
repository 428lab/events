import { useMemo, useState } from "react";
import { Avatar, Box, Button, Checkbox, Chip, FormControlLabel, MenuItem, Pagination, Stack, TextField, Typography } from "@mui/material";
import { EVENT_ROLES, type EventNameCard } from "@eventer/shared";
import { useTranslation } from "react-i18next";
import { roleLabel } from "../../lib/format.js";

const PAGE_SIZE = 20;
const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
export function NameCardSelection({ cards, excluded, onToggle, onSelectOnly }: {
  cards: EventNameCard[]; excluded: ReadonlySet<string>;
  onToggle: (id: string) => void; onSelectOnly: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(""), [role, setRole] = useState(""), [slot, setSlot] = useState("");
  const [requestedPage, setPage] = useState(1);
  const slots = useMemo(() => [...new Map(cards.filter(c => c.slotId).map(c => [c.slotId!, c.slotName ?? c.slotId!])).entries()], [cards]);
  const matching = useMemo(() => {
    const term = normalize(query.trim());
    return cards.filter(c => (!term || normalize(c.name).includes(term) || normalize(c.handle).includes(term))
      && (!role || c.role === role) && (!slot || (slot === "__none__" ? !c.slotId : c.slotId === slot)));
  }, [cards, query, role, slot]);
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE)), page = Math.min(requestedPage, pages);
  const start = (page - 1) * PAGE_SIZE;
  return <Stack spacing={1}>
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
      <TextField size="small" fullWidth label={t("staffOps.nameCardSearch")} value={query}
        onChange={e => { setQuery(e.target.value); setPage(1); }} />
      <TextField select size="small" label={t("staffOps.cardEditorRole")} value={role} sx={{ minWidth: 150 }}
        onChange={e => { setRole(e.target.value); setPage(1); }}>
        <MenuItem value="">{t("staffOps.nameCardAllRoles")}</MenuItem>
        {EVENT_ROLES.map(value => <MenuItem key={value} value={value}>{roleLabel(value)}</MenuItem>)}
      </TextField>
      <TextField select size="small" label={t("staffOps.cardEditorSlot")} value={slot} sx={{ minWidth: 150, maxWidth: { sm: 260 } }}
        onChange={e => { setSlot(e.target.value); setPage(1); }}>
        <MenuItem value="">{t("staffOps.nameCardAllSlots")}</MenuItem>
        <MenuItem value="__none__">{t("staffOps.nameCardNoSlot")}</MenuItem>
        {slots.map(([id, name]) => <MenuItem key={id} value={id}>{name}</MenuItem>)}
      </TextField>
    </Stack>
    <Typography variant="caption" color="text.secondary">{t("staffOps.nameCardSelectionHint")}</Typography>
    <Button size="small" sx={{ alignSelf: "flex-start" }} disabled={!matching.length}
      onClick={() => onSelectOnly(matching.map(c => c.id))}>{t("staffOps.nameCardSelectFilteredOnly")}</Button>
    <Box data-name-card-selection sx={{ display: "grid", gridTemplateColumns: {
      xs: "minmax(0,1fr)", sm: "repeat(2,minmax(0,1fr))", md: "repeat(3,minmax(0,1fr))",
    }, gap: 0.5 }}>
      {matching.slice(start, start + PAGE_SIZE).map(c => <FormControlLabel key={c.id}
        sx={{ m: 0, minWidth: 0, "& .MuiFormControlLabel-label": { minWidth: 0, flex: 1 } }}
        control={<Checkbox size="small" checked={!excluded.has(c.id)} onChange={() => onToggle(c.id)}
          inputProps={{ "aria-label": t("staffOps.nameCardPrintCheckbox", { name: c.name }) }} />}
        label={<Stack component="span" direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Avatar src={c.avatarUrl ?? undefined} sx={{ width: 24, height: 24, flexShrink: 0 }}>{[...c.name][0] ?? "?"}</Avatar>
          <Typography component="span" variant="body2" sx={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>{c.name}</Typography>
          {c.role !== "participant" && <Chip size="small" label={roleLabel(c.role)} sx={{ flexShrink: 0 }} />}
        </Stack>} />)}
    </Box>
    {!matching.length && <Typography>{t("staffOps.nameCardNoMatches")}</Typography>}
    <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} alignItems="center">
      <Typography variant="caption">{t("staffOps.nameCardListRange", { from: matching.length ? start + 1 : 0, to: Math.min(start + PAGE_SIZE, matching.length), total: matching.length })}</Typography>
      {pages > 1 && <Pagination size="small" count={pages} page={page} onChange={(_, value) => setPage(value)}
        getItemAriaLabel={(type, value) => t(type === "next" ? "staffOps.nameCardNextPage" : type === "previous" ? "staffOps.nameCardPreviousPage" : "staffOps.nameCardPage", { page: value ?? 1 })} />}
    </Stack>
  </Stack>;
}

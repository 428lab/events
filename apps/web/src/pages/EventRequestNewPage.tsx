import { useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import EggIcon from "@mui/icons-material/Egg";
import StadiumIcon from "@mui/icons-material/Stadium";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { VenueType } from "@eventer/shared";
import { VENUE_TYPES } from "@eventer/shared";
import { useCreateEventRequest } from "../api/requestHooks.js";
import { CounterTextField } from "../components/CounterTextField.js";
import { useMyJoinedCommunities } from "../api/communityHooks.js";
import { venueLabel } from "../lib/format.js";

/** イベントのたまご投稿（あったらいいな）。 */
export function EventRequestNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateEventRequest();
  const { data: myCommunities } = useMyJoinedCommunities();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [venuePref, setVenuePref] = useState<VenueType | "">("");
  const [communityId, setCommunityId] = useState(
    searchParams.get("communityId") ?? "",
  );
  const [membersOnly, setMembersOnly] = useState(false);
  const [venueWanted, setVenueWanted] = useState(false);
  const [reactorsAnonymous, setReactorsAnonymous] = useState(false);

  const submit = () => {
    create.mutate(
      {
        title,
        description,
        venueTypePref: venuePref || null,
        communityId: communityId || null,
        membersOnly: communityId ? membersOnly : false,
        venueWanted,
        reactorsAnonymous,
      },
      {
        onSuccess: ({ request }) => navigate(`/requests/${request.id}`),
      },
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography
          variant="h5"
          fontWeight={700}
          gutterBottom
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <EggIcon fontSize="medium" />
          {t("egg.newTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("egg.newLead", { action: t("egg.host") })}
        </Typography>
        <Stack spacing={2.5}>
          <CounterTextField
            label={t("egg.titleLabel")}
            slotProps={{ inputLabel: { shrink: true } }}
            placeholder={t("egg.titlePlaceholder")}
            value={title}
            max={200}
            onChange={(e) => setTitle(e.target.value)}
            required
            fullWidth
          />
          <CounterTextField
            label={t("egg.descriptionLabel")}
            slotProps={{ inputLabel: { shrink: true } }}
            placeholder={t("egg.descriptionPlaceholder")}
            value={description}
            max={4000}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={3}
            fullWidth
          />
          <div>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {t("egg.venuePrefLabel")}
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={venuePref}
              onChange={(_e, v: VenueType | null) => setVenuePref(v ?? "")}
            >
              {VENUE_TYPES.map((v) => (
                <ToggleButton key={v} value={v}>
                  {venueLabel(v)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </div>
          {myCommunities && myCommunities.length > 0 && (
            <TextField
              select
              // イベント作成フォームと同じ綴りなので使い回す（増やさない）
              label={t("eventForm.community")}
              value={communityId}
              onChange={(e) => setCommunityId(e.target.value)}
              helperText={t("egg.communityHelp")}
              fullWidth
            >
              <MenuItem value="">{t("egg.communityNone")}</MenuItem>
              {myCommunities.map((cm) => (
                <MenuItem key={cm.id} value={cm.id}>
                  {cm.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <FormControlLabel
            control={
              <Switch
                checked={venueWanted}
                onChange={(e) => setVenueWanted(e.target.checked)}
              />
            }
            label={
              <Box
                component="span"
                sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
              >
                <StadiumIcon fontSize="small" />
                {t("egg.venueWantedSwitch")}
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Switch
                checked={reactorsAnonymous}
                onChange={(e) => setReactorsAnonymous(e.target.checked)}
              />
            }
            label={t("egg.reactorsAnonSwitch")}
          />
          {communityId && (
            <FormControlLabel
              control={
                <Switch
                  checked={membersOnly}
                  onChange={(e) => setMembersOnly(e.target.checked)}
                />
              }
              label={t("egg.membersOnlySwitch")}
            />
          )}
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5}>
            <Button
              variant="contained"
              onClick={submit}
              disabled={!title.trim() || create.isPending}
            >
              {t("egg.newSubmit")}
            </Button>
            <Button onClick={() => navigate(-1)}>{t("common.cancel")}</Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

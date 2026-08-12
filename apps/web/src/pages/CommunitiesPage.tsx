import {
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { useMe } from "../api/hooks.js";
import { useCommunities } from "../api/communityHooks.js";

export function CommunitiesPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { data: communities, isLoading } = useCommunities();

  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="center" spacing={2}>
        <Typography variant="h5" fontWeight={700} sx={{ flex: 1 }}>
          {t("nav.communities")}
        </Typography>
        {me && (
          <Button
            variant="contained"
            component={RouterLink}
            to="/communities/new"
          >
            {t("community.create")}
          </Button>
        )}
      </Stack>

      {isLoading || !communities ? (
        <Typography>{t("common.loading")}</Typography>
      ) : communities.length === 0 ? (
        <Typography color="text.secondary">{t("community.empty")}</Typography>
      ) : (
        <Stack spacing={1.5}>
          {communities.map((c) => (
            <Card key={c.id} variant="outlined">
              <CardActionArea component={RouterLink} to={`/c/${c.slug}`}>
                <CardContent>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Avatar
                      src={c.iconUrl ?? undefined}
                      variant="rounded"
                      sx={{ width: 48, height: 48 }}
                    >
                      {c.name.charAt(0)}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontWeight={700} noWrap>
                        {c.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        @{c.slug}
                        {t("common.dotSeparator")}
                        {t(
                          c.memberCount === 1
                            ? "community.memberCountOne"
                            : "community.memberCount",
                          { n: c.memberCount },
                        )}
                        {t("common.dotSeparator")}
                        {t(
                          c.eventCount === 1
                            ? "community.eventCountOne"
                            : "community.eventCount",
                          { n: c.eventCount },
                        )}
                      </Typography>
                    </Box>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

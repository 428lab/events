import { useState } from "react";
import {
  Divider,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Switch,
  Tooltip,
} from "@mui/material";
import PaletteIcon from "@mui/icons-material/Palette";
import CheckIcon from "@mui/icons-material/Check";
import { useTranslation } from "react-i18next";
import { THEME_LIST, THEMES } from "../theme/themes.js";
import { useThemeSettings } from "../theme/ThemeContext.js";

export function ThemeSwitcher() {
  const { t } = useTranslation();
  const { themeKey, setThemeKey, fireworksOn, setFireworksOn } =
    useThemeSettings();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const hasFireworks = Boolean(THEMES[themeKey]?.fireworks);

  return (
    <>
      <Tooltip title={t("nav.theme")}>
        <IconButton
          color="inherit"
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-label={t("nav.theme")}
        >
          <PaletteIcon />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {THEME_LIST.map((theme) => (
          <MenuItem
            key={theme.key}
            selected={theme.key === themeKey}
            onClick={() => {
              setThemeKey(theme.key);
              setAnchor(null);
            }}
          >
            <ListItemText>{theme.label}</ListItemText>
            {theme.key === themeKey && (
              <CheckIcon fontSize="small" sx={{ ml: 1 }} />
            )}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem
          disabled={!hasFireworks}
          onClick={() => setFireworksOn(!fireworksOn)}
        >
          <ListItemText
            secondary={
              !hasFireworks ? t("nav.fireworksUnavailable") : undefined
            }
          >
            {t("nav.fireworks")}
          </ListItemText>
          <Switch edge="end" checked={fireworksOn && hasFireworks} />
        </MenuItem>
      </Menu>
    </>
  );
}

import { Box, ButtonBase, Typography, useTheme } from "@mui/material";
import CheckCircle from "@mui/icons-material/CheckCircle";
import { isMobile } from "@/util/misc";
import { useAppTheme } from "./AppThemeProvider";
import { themeNames, themeLabel, themes } from "./themes";

/**
 * One little preview card per theme, drawn in that theme's own colours (light or dark to
 * match what's showing now). Scrolls sideways on phones, wraps on desktop.
 */
export function ThemeSwatches() {
  const { name, setName } = useAppTheme();
  const mode = useTheme().palette.mode;

  return (
    <Box
      sx={{
        display: "flex",
        gap: 1.5,
        mx: -2,
        px: 2,
        py: 0.5,
        ...(isMobile()
          ? { overflowX: "auto", scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }
          : { flexWrap: "wrap" }),
      }}
    >
      {themeNames.map((n) => {
        const p = themes[n][mode].palette;
        const selected = n === name;
        return (
          <ButtonBase
            key={n}
            onClick={() => setName(n)}
            aria-pressed={selected}
            sx={{ flexShrink: 0, width: 96, flexDirection: "column", gap: 0.5, borderRadius: "8px" }}
          >
            <Box
              sx={{
                position: "relative",
                width: "100%",
                height: 140,
                overflow: "hidden",
                borderRadius: "8px",
                border: 2,
                borderColor: selected ? p.primary.main : "divider",
                bgcolor: p.background.default,
              }}
            >
              <Box sx={{ height: 24, bgcolor: p.background.paper }} />
              <Box sx={{ m: 1, mb: 0.5, height: 8, width: "60%", borderRadius: "3px", bgcolor: p.primary.main }} />
              <Box sx={{ mx: 1, mb: 0.5, height: 6, borderRadius: "3px", bgcolor: p.background.paper }} />
              <Box sx={{ mx: 1, height: 6, width: "80%", borderRadius: "3px", bgcolor: p.background.paper }} />
              <Box
                sx={{
                  position: "absolute", right: 8, bottom: 8, width: 24, height: 24,
                  borderRadius: "6px", bgcolor: p.primary.main,
                }}
              />
              {selected && (
                <CheckCircle
                  sx={{ position: "absolute", top: 28, right: 6, fontSize: 18, color: p.primary.main }}
                />
              )}
            </Box>
            <Typography
              variant="caption"
              sx={{ textAlign: "center", fontWeight: selected ? 600 : 400 }}
            >
              {themeLabel(n)}
            </Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
}

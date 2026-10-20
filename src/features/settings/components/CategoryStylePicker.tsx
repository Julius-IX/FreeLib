import { Box, useTheme } from "@mui/material";
import { CategoryChip } from "@/components/CategoryChip";
import { CATEGORY_STYLES, useCategoryStyle } from "@/features/library/categoryStyle";

const SAMPLE_NAMES = ["Lent Out", "Borrowed"];

/** One card of sample chips per style. Tap a card to pick it. */
export function CategoryStylePicker() {
  const [style, setStyle] = useCategoryStyle();
  // Sample colours come from the current theme, so the previews fit in instead of standing out.
  const { primary } = useTheme().palette;
  const sample = [
    { name: SAMPLE_NAMES[0], color: primary.main },
    { name: SAMPLE_NAMES[1], color: primary.dark },
  ];
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 1.5 }}>
      {CATEGORY_STYLES.map((s) => (
        <Box
          key={s.value}
          component="button"
          type="button"
          aria-pressed={style === s.value}
          aria-label={s.label}
          onClick={() => setStyle(s.value)}
          sx={{
            font: "inherit",
            color: "text.primary",
            textAlign: "left",
            cursor: "pointer",
            bgcolor: "transparent",
            borderRadius: "4px",
            p: 1.25,
            border: 2,
            borderColor: style === s.value ? "primary.main" : "divider",
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          <Box component="span" sx={{ fontSize: 12, color: "text.secondary" }}>
            {s.label}
          </Box>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", flexWrap: "wrap" }}>
            {sample.map((c) => (
              <CategoryChip key={c.name} category={c} variant={s.value} />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

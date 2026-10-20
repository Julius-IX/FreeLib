import { Box } from "@mui/material";
import { RatingIcons } from "@/components/RatingIcons";
import { RATING_STYLES, useRatingStyle } from "@/features/library/ratingStyle";

// 7 of 10 = three and a half icons, so each card also shows what a half looks like.
const SAMPLE = 7;

/** One card per style with a sample rating in it. Tap a card to pick it. */
export function RatingStylePicker() {
  const [style, setStyle] = useRatingStyle();
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 1.5 }}>
      {RATING_STYLES.map((s) => (
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
          <RatingIcons value={SAMPLE} style={s.value} size={22} />
        </Box>
      ))}
    </Box>
  );
}

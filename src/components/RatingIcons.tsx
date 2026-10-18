import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { Box } from "@mui/material";
import {
  RATING_ICONS, RATING_MAX, formatRatingNumber, ratingAtPoint, ratingFill, stepRating,
} from "@/features/library/rating";
import { ratingStyleDef, useRatingThemeColor, type RatingStyle } from "@/features/library/ratingStyle";

/** Space between two icons, as padding inside each one's tap area. */
const GAP = 4;

type Props = {
  /** 0-10, fractions included (7.5 fills three and three quarters of the icons). 0 = unrated. */
  value: number;
  style: RatingStyle;
  /** Icon size in px. */
  size?: number;
  /**
   * Makes it tappable: the left half of an icon is half an icon, the right half the whole icon,
   * and tapping the rating you already have clears it. Leave it out for a plain picture.
   */
  onChange?: (value: number) => void;
};

/** A rating drawn as `RATING_ICONS` icons, filled up to `value`. */
export function RatingIcons({ value, style, size = 28, onChange }: Props) {
  const { Icon, Empty, color: styleColor } = ratingStyleDef(style);
  const [themeColor] = useRatingThemeColor();
  const color = themeColor ? "primary.main" : (styleColor ?? "primary.main");
  const EmptyShape = Empty ?? Icon;
  const ref = useRef<HTMLDivElement>(null);
  // what a mouse would pick right now; shown instead of `value` while hovering
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  const interactive = !!onChange;

  const pointValue = (e: PointerEvent | MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    return rect ? ratingAtPoint(e.clientX - rect.left, rect.width) : 0;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const next =
      e.key === "ArrowRight" || e.key === "ArrowUp" ? stepRating(value, 1)
        : e.key === "ArrowLeft" || e.key === "ArrowDown" ? stepRating(value, -1)
          : e.key === "Home" ? 0
            : e.key === "End" ? RATING_MAX
              : null;
    if (next === null || !onChange) return;
    e.preventDefault();
    if (next !== value) onChange(next);
  };

  return (
    <Box
      ref={ref}
      {...(interactive
        ? {
          role: "slider",
          tabIndex: 0,
          "aria-label": "Rating",
          "aria-valuemin": 0,
          "aria-valuemax": RATING_MAX,
          "aria-valuenow": value,
          "aria-valuetext": value > 0 ? `${formatRatingNumber(value)} out of ${RATING_MAX}` : "Not rated",
          onKeyDown,
          onClick: (e: MouseEvent) => {
            const picked = pointValue(e);
            onChange(picked === value ? 0 : picked);
          },
          // hover preview is for a mouse only: on touch it would stick after a tap
          onPointerMove: (e: PointerEvent) => setHover(e.pointerType === "mouse" ? pointValue(e) : null),
          onPointerLeave: () => setHover(null),
        }
        : { role: "img", "aria-label": value > 0 ? `${formatRatingNumber(value)} out of ${RATING_MAX}` : "Not rated" })}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
        ...(interactive && {
          cursor: "pointer",
          touchAction: "manipulation", // no double-tap-to-zoom delay on a quick second tap
          borderRadius: "6px",
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
        }),
      }}
    >
      {Array.from({ length: RATING_ICONS }, (_, i) => {
        const fill = ratingFill(shown, i);
        return (
          <Box
            key={i}
            aria-hidden
            sx={{ position: "relative", width: size, height: size, mx: `${GAP / 2}px`, flexShrink: 0 }}
          >
            {/* the empty slot underneath, then the filled shape on top, cut off at `fill` of its width */}
            <EmptyShape
              sx={{
                position: "absolute",
                inset: 0,
                fontSize: size,
                color: Empty ? "action.disabled" : color,
                opacity: Empty ? 1 : 0.25,
              }}
            />
            {fill > 0 && (
              <Box sx={{ position: "absolute", inset: 0, overflow: "hidden", width: `${fill * 100}%` }}>
                <Icon sx={{ fontSize: size, color }} />
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

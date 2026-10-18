import type { SvgIconComponent } from "@mui/icons-material";
import { createSvgIcon } from "@mui/material/utils";
import CircleIcon from "@mui/icons-material/Circle";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import BookmarkBorderRoundedIcon from "@mui/icons-material/BookmarkBorderRounded";
import BookmarkRoundedIcon from "@mui/icons-material/BookmarkRounded";
import FavoriteBorderRoundedIcon from "@mui/icons-material/FavoriteBorderRounded";
import FavoriteRoundedIcon from "@mui/icons-material/FavoriteRounded";
import LocalFireDepartmentOutlinedIcon from "@mui/icons-material/LocalFireDepartmentOutlined";
import LocalFireDepartmentRoundedIcon from "@mui/icons-material/LocalFireDepartmentRounded";
import StarBorderRoundedIcon from "@mui/icons-material/StarBorderRounded";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import { isBoolean, useSetting } from "@/lib/settings";

/** A tea bag: crimped top, a slit across the bag, string and paper tag. MUI has no such icon. */
const TeaBagIcon = createSvgIcon(
  <>
    <path d="M15.5 1.5h4.5a1.5 1.5 0 0 1 1.5 1.5v2.5a1.5 1.5 0 0 1-1.5 1.5h-4.5a1.5 1.5 0 0 1-1.5-1.5V3a1.5 1.5 0 0 1 1.5-1.5z" />
    <path d="M11.3 8.8V6.6l3.2-2.7.9 1.05-3.15 2.65V8.8z" />
    <path
      fillRule="evenodd"
      d="M5 10.3l1.4-1.5 1.4 1.5 1.4-1.5 1.4 1.5 1.4-1.5 1.4 1.5 1.4-1.5 1.4 1.5 1.4-1.5 1.4 1.5v9.7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM7.2 13.2v1.2h9.6v-1.2z"
    />
  </>,
  "TeaBag",
);

type RatingStyleDef = {
  value: string;
  label: string;
  /** The filled shape. */
  Icon: SvgIconComponent;
  /**
   * The shape of an empty slot. Leave it out and the filled shape is drawn faded instead, so a
   * new style only needs one icon.
   */
  Empty?: SvgIconComponent;
  /** What the filled shape is coloured. Leave it out for the theme's primary colour. */
  color?: string;
};

/**
 * Every way a rating can be drawn. To add a style, add one entry here: the setting's type and
 * its validation, the picker in settings and the rating row all follow from this list.
 * Whatever the icons, a rating is always 5 of them (see `rating.ts`).
 */
export const RATING_STYLES = [
  { value: "stars", label: "Stars", Icon: StarRoundedIcon, Empty: StarBorderRoundedIcon, color: "#f5b301" },
  { value: "teabag", label: "Tea bags", Icon: TeaBagIcon, color: "#b8743a" },
  { value: "hearts", label: "Hearts", Icon: FavoriteRoundedIcon, Empty: FavoriteBorderRoundedIcon, color: "#e5484d" },
  { value: "flames", label: "Flames", Icon: LocalFireDepartmentRoundedIcon, Empty: LocalFireDepartmentOutlinedIcon, color: "#f76b15" },
  { value: "bookmarks", label: "Bookmarks", Icon: BookmarkRoundedIcon, Empty: BookmarkBorderRoundedIcon },
  { value: "circles", label: "Circles", Icon: CircleIcon, Empty: CircleOutlinedIcon },
] as const satisfies readonly RatingStyleDef[];

export type RatingStyle = (typeof RATING_STYLES)[number]["value"];

export const ratingStyleDef = (style: RatingStyle): RatingStyleDef =>
  RATING_STYLES.find((s) => s.value === style) ?? RATING_STYLES[0];

const isRatingStyle = (v: unknown): v is RatingStyle => RATING_STYLES.some((s) => s.value === v);

/** Saved in settings.json under `ratingStyle` (also listed in `KNOWN` in settings.rs). */
export const useRatingStyle = () => useSetting<RatingStyle>("ratingStyle", "stars", isRatingStyle);

/** Whether a book's page shows its rating at all. Saved under `showRating` (also in `KNOWN`). */
export const useShowRating = () => useSetting<boolean>("showRating", true, isBoolean);

/**
 * Draw every rating style in the theme's primary colour instead of the colour the style comes
 * with (gold stars, red hearts, ...). Saved under `ratingThemeColor` (also in `KNOWN`).
 */
export const useRatingThemeColor = () => useSetting<boolean>("ratingThemeColor", true, isBoolean);

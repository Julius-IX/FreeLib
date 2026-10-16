import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import NumbersIcon from "@mui/icons-material/Numbers";
import CollectionsBookmarkOutlinedIcon from "@mui/icons-material/CollectionsBookmarkOutlined";
import { fmtDate } from "./format";
import type { BookDetails } from "./types";

function MetaRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, color: "text.secondary", minWidth: 0 }}>
      <Box sx={{ display: "flex", "& svg": { fontSize: 16 } }}>{icon}</Box>
      <Typography variant="body2" color="inherit" sx={{ overflowWrap: "anywhere" }}>
        {children}
      </Typography>
    </Box>
  );
}

/** Title, authors and the meta rows **/
export function BookInfo({ details, large = false }: { details: BookDetails; large?: boolean }) {
  const { book, authors, series } = details;
  const hasMeta = book.publishDate || book.isbn || book.pageCount !== null || series;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, minWidth: 0 }}>
      <Typography
        variant={large ? "h4" : "h6"}
        sx={{ fontWeight: 700, lineHeight: 1.2, overflowWrap: "anywhere" }}
      >
        {book.title}
      </Typography>
      {authors.length > 0 && (
        <Typography variant={large ? "h6" : "subtitle2"} color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
          {authors.map((a) => a.name).join(", ")}
        </Typography>
      )}
      {hasMeta && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mt: 0.5 }}>
          <MetaRow icon={<CalendarMonthOutlinedIcon />}>{book.publishDate ? fmtDate(book.publishDate) : "Unknown"}</MetaRow>
          <MetaRow icon={<MenuBookOutlinedIcon />}>{book.pageCount ?? "Unknown"} pages</MetaRow>
          <MetaRow icon={<NumbersIcon />}>{book.isbn ?? "Unknown"}</MetaRow>
          {series && (
            <MetaRow icon={<CollectionsBookmarkOutlinedIcon />}>
              {series.name}
              {book.seriesPosition !== null && ` · #${book.seriesPosition}`}
            </MetaRow>
          )}
        </Box>
      )}
    </Box>
  );
}

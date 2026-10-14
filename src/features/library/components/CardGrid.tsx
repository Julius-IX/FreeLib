import { useEffect, useState } from "react";
import { Box, Slider } from "@mui/material";
import BookCard from "./BookCard";
import { Book } from "@/lib/types";
import { isMobile } from "@/util/misc";

export default function CardGrid({
  items,
  onOpen,
}: {
  items: Book[];
  onOpen?: (book: Book) => void;
}) {
  const isOnMobile = isMobile();
  const defaultColumns = isOnMobile ? 3 : 6;
  const [columns, setColumns] = useState(defaultColumns);

  // Reset to the platform default if the mobile flag changes after mount
  useEffect(() => setColumns(defaultColumns), [defaultColumns]);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <Slider
        value={columns}
        onChange={(_, v) => setColumns(v as number)}
        min={1}
        max={isOnMobile ? 5 : 10}
        step={1}
        marks
        valueLabelDisplay="auto"
        sx={{ flexShrink: 0 }}
      />

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          scrollbarWidth: "none", // Firefox
          "&::-webkit-scrollbar": { display: "none" }, // WebKit webviews
        }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: isOnMobile ? 1 : 2,
          }}
        >
          {items.map((book) => (
            <BookCard key={book.bookId} book={book} onClick={onOpen} />
          ))}
        </Box>
      </Box>
    </Box>
  );
}

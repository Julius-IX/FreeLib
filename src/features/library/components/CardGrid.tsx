import { Box } from "@mui/material";
import BookCard from "./BookCard";
import { Book } from "@/lib/types";
import { isMobile } from "@/util/misc";
import { useLibraryColumns } from "../libraryColumns";

export default function CardGrid({
  items,
  onOpen,
}: {
  items: Book[];
  onOpen?: (book: Book) => void;
}) {
  const isOnMobile = isMobile();
  const [columns] = useLibraryColumns();

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
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

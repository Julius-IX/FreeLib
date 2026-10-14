import placeholderCover from "@/assets/placeholder-cover.png";
import { useCoverPath } from "../components/BookCard";
import { useCoverRevision } from "../libraryEvents";
import { useLocalImage } from "../screens/CoverPreview";

/** `path`: the saved cover file, if any (what the edit form is prefilled with). `url`: what to show. */
export function useBookCover(isbn: string | null | undefined) {
  const rev = useCoverRevision(isbn);
  const path = useCoverPath(isbn, rev);
  const url = useLocalImage(path, rev).url ?? placeholderCover;
  return { path, url };
}

import placeholderCover from "@/assets/placeholder-cover.png";
import { useCover } from "../useCover";

/** `path`: the saved cover file, if any (what the edit form is prefilled with). `url`: what to show. */
export function useBookCover(bookId: number | null | undefined) {
  const { path, url } = useCover(bookId);
  return { path, url: url ?? placeholderCover };
}

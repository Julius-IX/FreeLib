import placeholderCover from "@/assets/placeholder-cover.png";
import { useCover } from "../useCover";

/** `path`: the saved cover file, if any (what the edit form is prefilled with). `url`: what to show. */
export function useBookCover(isbn: string | null | undefined) {
  const { path, url } = useCover(isbn);
  return { path, url: url ?? placeholderCover };
}

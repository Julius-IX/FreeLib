import type { Author, Book, Reading, Series, Tag } from "@/lib/types";

export type BookDetails = { book: Book; authors: Author[]; tags: Tag[]; series: Series | null };

export type BookViewState =
  | { status: "loading" }
  | { status: "ready"; details: BookDetails; readings: Reading[] }
  | { status: "missing"; message: string };

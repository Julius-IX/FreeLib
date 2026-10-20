import { useEffect, useMemo, useState } from "react";
import { commands } from "@/lib/commands";
import type { LibrarySummary, StatsResult } from "@/lib/types";
import { useLibraryRevision } from "@/features/library/libraryEvents";
import type { StatsForm } from "./options";
import { toQuery } from "./toQuery";

/** Typing in the search box would otherwise run a query per key. */
const DEBOUNCE_MS = 250;

type Loaded<T> = { data: T | null; error: string | null; loading: boolean };

/**
 * The answer to `form`, re-asked when it changes and when the library does (a book was saved or
 * deleted). The previous answer stays on screen while the next one loads, so the chart doesn't
 * blink on every change.
 */
export function useStatsResult(form: StatsForm): Loaded<StatsResult> {
  const revision = useLibraryRevision();
  const query = useMemo(() => toQuery(form), [form]);
  const [state, setState] = useState<Loaded<StatsResult>>({ data: null, error: null, loading: true });

  useEffect(() => {
    let stale = false;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      commands.stats
        .runStats({ query })
        .then((data) => !stale && setState({ data, error: null, loading: false }))
        .catch((e) => !stale && setState((s) => ({ ...s, error: String(e), loading: false })));
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, revision]);

  return state;
}

export function useLibrarySummary(): Loaded<LibrarySummary> {
  const revision = useLibraryRevision();
  const [state, setState] = useState<Loaded<LibrarySummary>>({ data: null, error: null, loading: true });

  useEffect(() => {
    let stale = false;
    commands.stats
      .librarySummary()
      .then((data) => !stale && setState({ data, error: null, loading: false }))
      .catch((e) => !stale && setState((s) => ({ ...s, error: String(e), loading: false })));
    return () => {
      stale = true;
    };
  }, [revision]);

  return state;
}

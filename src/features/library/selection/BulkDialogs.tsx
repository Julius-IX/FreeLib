import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { commands } from "@/lib/commands";
import type { Category, Shelf } from "@/lib/types";
import { TagField } from "@/components/TagField";
import { notify } from "@/notifications/notify";
import { choiceKey, toDraft } from "../book-form/choice";
import { loadTags } from "../book-form/ChoicesField";
import { CategoryField } from "../book-form/CategoryField";
import { normTag } from "../book-form/inputs";
import type { Choice } from "../book-form/types";
import { bumpLibrary } from "../libraryEvents";
import {
  type BulkSummary,
  type LinkChanges,
  type ListChange,
  type ListMode,
  editLinks,
  editShelves,
  resolveTagIds,
  runBulk,
} from "./bulkOps";

// SECTION: running an operation

export type BulkReport = {
  summary: string;
  details: string[];
  severity: "success" | "warning" | "error";
};

/** An operation the run dialog executes as soon as it opens. */
export type BulkRun = {
  title: string;
  total: number;
  run: (ctx: { onProgress: (done: number) => void; shouldStop: () => boolean }) => Promise<BulkReport>;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function bulkReport(s: BulkSummary, verb: string): BulkReport {
  const details: string[] = [];
  if (s.unchanged > 0) details.push(`${plural(s.unchanged, "book", "books")} had nothing to change`);
  if (s.failed > 0) details.push(`${s.failed} failed`);
  if (s.stopped) details.push("Stopped before the end");
  details.push(...s.problems);
  return {
    summary: `${verb} ${plural(s.changed, "book", "books")}`,
    details,
    severity: s.total > 0 && s.failed === s.total ? "error" : s.failed > 0 || s.stopped ? "warning" : "success",
  };
}

const errorMessage = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));

/**
 * Runs the operation and shows its progress. It can only be closed once the operation has ended, a
 * stop in the middle is what the button is for. Starting is guarded by a ref because React runs
 * effects twice in development, which would run a delete twice.
 */
export function BulkRunDialog({ op, onClose }: { op: BulkRun; onClose: () => void }) {
  const [done, setDone] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [report, setReport] = useState<BulkReport | null>(null);
  const started = useRef(false);
  const stopRequested = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    op.run({ onProgress: setDone, shouldStop: () => stopRequested.current })
      .then(setReport)
      .catch((e) => setReport({ summary: errorMessage(e), details: [], severity: "error" }));
  }, [op]);

  return (
    <Dialog open fullWidth maxWidth="xs" onClose={() => report && onClose()}>
      <DialogTitle>{op.title}</DialogTitle>
      <DialogContent>
        {report ? (
          <Alert severity={report.severity}>
            {report.summary}
            {report.details.map((d) => (
              <Typography key={d} variant="body2">
                {d}
              </Typography>
            ))}
          </Alert>
        ) : (
          <Box sx={{ pt: 1 }}>
            <LinearProgress variant="determinate" value={op.total ? (done / op.total) * 100 : 0} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {done} of {op.total}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {report ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <Button
            disabled={stopping}
            onClick={() => {
              stopRequested.current = true;
              setStopping(true);
            }}
          >
            {stopping ? "Stopping…" : "Stop"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

// SECTION: confirmation

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  destructive,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onClose={onCancel}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{children}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button color={destructive ? "error" : "primary"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// SECTION: tags, categories and shelves

export type LinkKind = "tags" | "categories" | "shelves";

const NOUN: Record<LinkKind, { title: string; plural: string }> = {
  tags: { title: "Tags", plural: "tags" },
  categories: { title: "Categories", plural: "categories" },
  shelves: { title: "Shelves", plural: "shelves" },
};

const MODE_HELP: Record<ListMode, (noun: string) => string> = {
  add: (noun) => `Adds the picked ${noun} to every selected book.`,
  remove: (noun) => `Removes the picked ${noun} from the selected books that have them.`,
  set: (noun) => `Replaces the ${noun} of every selected book with the picked ones. Picking none clears them.`,
};

/**
 * Picks tags, categories or shelves and what to do with them (add, remove, replace). Starts the
 * run dialog through `onStart`. New tags can be typed in unless the mode is "remove", they are
 * created once up front so that no book ends up with its own copy.
 */
export function LinkPickDialog({
  kind,
  bookIds,
  onCancel,
  onStart,
}: {
  kind: LinkKind;
  bookIds: number[];
  onCancel: () => void;
  onStart: (op: BulkRun) => void;
}) {
  const [mode, setMode] = useState<ListMode>("add");
  const [tagOptions, setTagOptions] = useState<Choice[]>([]);
  const [tags, setTags] = useState<Choice[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [shelfOptions, setShelfOptions] = useState<Shelf[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);

  useEffect(() => {
    const failed = (e: unknown) => notify(`Couldn't load ${NOUN[kind].plural}: ${String(e)}`, { severity: "error" });
    if (kind === "tags") loadTags().then(setTagOptions).catch(failed);
    if (kind === "shelves") commands.db_crud.listShelves().then(setShelfOptions).catch(failed);
  }, [kind]);

  const pickedCount = kind === "tags" ? tags.length : kind === "categories" ? categories.length : shelves.length;
  const noun = NOUN[kind].plural;

  const changeMode = (next: ListMode) => {
    setMode(next);
    // a tag that doesn't exist yet can't be removed from anything
    if (next === "remove") setTags((t) => t.filter((c) => c.id !== null));
  };

  const confirm = () => {
    const total = bookIds.length;
    const title = `${NOUN[kind].title} on ${plural(total, "book", "books")}`;
    onStart({
      title,
      total,
      run: async ({ onProgress, shouldStop }) => {
        try {
          const opts = { onProgress: (p: { done: number }) => onProgress(p.done), shouldStop };
          let summary: BulkSummary;
          if (kind === "shelves") {
            const change: ListChange = { mode, ids: shelves.map((s) => s.shelfId) };
            summary = await runBulk(bookIds, editShelves(change), opts);
          } else {
            const changes: LinkChanges = {};
            if (kind === "tags") changes.tags = { mode, ids: await resolveTagIds(tags) };
            else changes.categories = { mode, ids: categories.map((c) => c.categoryId) };
            summary = await runBulk(bookIds, editLinks(changes), opts);
          }
          return bulkReport(summary, "Changed");
        } finally {
          // also after a stop or an error: some books may already have changed
          bumpLibrary([]);
        }
      },
    });
  };

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onCancel}>
      <DialogTitle>{NOUN[kind].title}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          value={mode}
          onChange={(_, next: ListMode | null) => next && changeMode(next)}
          sx={{ mt: 1 }}
        >
          <ToggleButton value="add">Add</ToggleButton>
          <ToggleButton value="remove">Remove</ToggleButton>
          <ToggleButton value="set">Replace</ToggleButton>
        </ToggleButtonGroup>

        <DialogContentText>
          {plural(bookIds.length, "book", "books")} selected. {MODE_HELP[mode](noun)}
        </DialogContentText>

        {kind === "tags" && (
          <TagField<Choice>
            label="Tags"
            value={tags}
            onChange={setTags}
            options={tagOptions}
            getLabel={(c) => c.name}
            getKey={choiceKey}
            parseInput={mode === "remove" ? undefined : (text) => toDraft(text, normTag)}
          />
        )}
        {kind === "categories" && <CategoryField value={categories} onChange={setCategories} />}
        {kind === "shelves" && (
          <TagField<Shelf>
            label="Shelves"
            value={shelves}
            onChange={setShelves}
            options={shelfOptions}
            getLabel={(s) => s.name}
            getKey={(s) => s.shelfId}
            noOptionsText="No shelves. Create them in Settings"
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="contained"
          color={mode === "set" && pickedCount === 0 ? "error" : "primary"}
          disabled={mode !== "set" && pickedCount === 0}
          onClick={confirm}
        >
          {mode === "add" ? "Add" : mode === "remove" ? "Remove" : pickedCount === 0 ? "Clear all" : "Replace"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

import { useRef, useState } from "react";
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, LinearProgress, Radio, Typography,
} from "@mui/material";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { commands } from "@/lib/commands";
import { getSetting, isBoolean, useSetting } from "@/lib/settings";
import type { ImportFormat, ImportOptionSpec, LibraryImportOptions, LibraryImportReport } from "@/lib/types";
import { notify } from "@/notifications/notify";
import { bumpLibrary } from "@/features/library/libraryEvents";
import { type EnrichProgress, type EnrichResult, enrichBooks } from "@/features/library/book-form/enrichBooks";
import { Preference, Section, SwitchPreference } from "./Preferences";

/**
 * Import a library exported from another book app (Goodreads, ...).
 *
 * Everything shown here comes from the backend: `list_import_formats` says which formats exist,
 * how to get each one's file, which file extensions it uses and which switches it offers, so a
 * new format added in Rust shows up here without touching this file. The two switches every
 * format shares are defined below. All choices are remembered between imports.
 *
 * After the import itself (one transaction in Rust, so it is quick) comes the optional lookup
 * pass: the lookup plugins are run on every book that was created, one by one, to fill in covers,
 * blurbs, tags and so on. That part can take minutes, so it has a progress bar and can be stopped.
 * The books are already saved by then, so stopping loses nothing.
 */

const FORMAT_KEY = "import.format";
const ESTIMATE_DATES_KEY = "import.estimateDates";
const LOOKUP_KEY = "import.lookupDetails";

const ESTIMATE_DATES_DEFAULT = true;
const LOOKUP_DEFAULT = true;

const isString = (v: unknown): v is string => typeof v === "string";
const formatOptionKey = (formatId: string, key: string) => `import.${formatId}.${key}`;

/** Row inside a dialog: the preference rows have their own side padding, so cancel the dialog's. */
const inDialog = { mx: -2 };

function FormatOption({ formatId, spec }: { formatId: string; spec: ImportOptionSpec }) {
  const [on, setOn] = useSetting(formatOptionKey(formatId, spec.key), spec.defaultValue, isBoolean);
  return <SwitchPreference title={spec.label} summary={spec.description} checked={on} onChange={setOn} />;
}

/** The options as they are saved right now, read at the moment of importing. */
function currentOptions(format: ImportFormat): LibraryImportOptions {
  return {
    estimateDates: getSetting(ESTIMATE_DATES_KEY, ESTIMATE_DATES_DEFAULT, isBoolean),
    formatOptions: Object.fromEntries(
      format.options.map((o) => [
        o.key,
        getSetting(formatOptionKey(format.id, o.key), o.defaultValue, isBoolean),
      ]),
    ),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ImportSettings() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formats, setFormats] = useState<ImportFormat[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // idle -> importing (file read + database) -> lookup (plugins, per book) -> idle
  const [phase, setPhase] = useState<"idle" | "importing" | "lookup">("idle");
  const busy = phase !== "idle";
  const [progress, setProgress] = useState<EnrichProgress | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopRequested = useRef(false);
  const [report, setReport] = useState<{
    format: string;
    report: LibraryImportReport;
    lookup: EnrichResult | { error: string } | null;
  } | null>(null);

  const [savedFormat, setSavedFormat] = useSetting(FORMAT_KEY, "", isString);
  const [estimateDates, setEstimateDates] = useSetting(ESTIMATE_DATES_KEY, ESTIMATE_DATES_DEFAULT, isBoolean);
  const [lookupDetails, setLookupDetails] = useSetting(LOOKUP_KEY, LOOKUP_DEFAULT, isBoolean);

  // The saved format may be gone (renamed in a later version): fall back to the first one.
  const format = formats?.find((f) => f.id === savedFormat) ?? formats?.[0] ?? null;

  const openDialog = async () => {
    setDialogOpen(true);
    if (formats) return;
    setLoadError(null);
    try {
      setFormats(await commands.importer.listImportFormats());
    } catch (e) {
      setLoadError(String(e));
    }
  };

  const chooseAndImport = async () => {
    if (!format) return;
    try {
      // Desktop: a path. Android: a content:// URI from the system file chooser.
      const file = await open({
        title: `Choose your ${format.name} export`,
        multiple: false,
        directory: false,
        filters: [{ name: `${format.name} export`, extensions: format.extensions }],
      });
      if (typeof file !== "string") return; // cancelled

      setPhase("importing");
      // readFile (not readTextFile) is the permission the app already has. A BOM is dropped.
      const text = new TextDecoder("utf-8").decode(await readFile(file));
      const result = await commands.importer.importLibrary({
        format: format.id,
        text,
        options: currentOptions(format),
      });
      bumpLibrary([]); // new books, and maybe new shelves (tabs)

      let lookup: EnrichResult | { error: string } | null = null;
      if (getSetting(LOOKUP_KEY, LOOKUP_DEFAULT, isBoolean) && result.importedBookIds.length > 0) {
        stopRequested.current = false;
        setStopping(false);
        setProgress(null);
        setPhase("lookup");
        try {
          lookup = await enrichBooks(result.importedBookIds, {
            onProgress: setProgress,
            shouldStop: () => stopRequested.current,
          });
          bumpLibrary(lookup.coverIds); // new covers, and the details that were filled in
        } catch (e) {
          lookup = { error: e instanceof Error && e.message ? e.message : String(e) };
        }
      }

      setDialogOpen(false);
      setReport({ format: format.name, report: result, lookup });
    } catch (e) {
      notify(`Import failed: ${String(e)}`, { severity: "error", duration: 12000 });
    } finally {
      setPhase("idle");
      setProgress(null);
    }
  };

  const close = () => !busy && setDialogOpen(false);
  const stopLookup = () => {
    stopRequested.current = true;
    setStopping(true);
  };

  return (
    <Section title="Import library">
      <Preference
        title="Import from another app"
        summary="Bring in the library you exported from Goodreads or another book app"
        onClick={openDialog}
      />

      <Dialog open={dialogOpen} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>Import from another app</DialogTitle>
        <DialogContent>
          {!formats && !loadError && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={28} />
            </Box>
          )}
          {loadError && <Alert severity="error">Couldn't load the import formats: {loadError}</Alert>}

          {formats && formats.length === 0 && (
            <DialogContentText>No import formats are available.</DialogContentText>
          )}

          {phase === "lookup" && (
            <LookupProgress progress={progress} stopping={stopping} />
          )}

          {format && formats && phase !== "lookup" && (
            <>
              {formats.length > 1 ? (
                formats.map((f) => (
                  <Box
                    key={f.id}
                    onClick={() => !busy && setSavedFormat(f.id)}
                    sx={{ display: "flex", alignItems: "center", cursor: "pointer" }}
                  >
                    <Radio checked={f.id === format.id} disabled={busy} />
                    <Typography>{f.name}</Typography>
                  </Box>
                ))
              ) : (
                <Typography variant="subtitle1">{format.name}</Typography>
              )}
              <DialogContentText sx={{ mt: 1, mb: 2 }}>{format.description}</DialogContentText>

              <Box sx={inDialog}>
                <SwitchPreference
                  title="Estimate missing read dates"
                  summary="When a finished book has no read date, use the date it was added instead. Off: such books get no reading history."
                  checked={estimateDates}
                  onChange={setEstimateDates}
                />
                <SwitchPreference
                  title="Look up details for imported books"
                  summary="Asks your lookup plugins about each imported book's ISBN and fills in what's missing: cover, blurb, tags, pages and more. Needs an internet connection and can take a while for a big library. You can stop it at any time."
                  checked={lookupDetails}
                  onChange={setLookupDetails}
                />
                {format.options.map((spec) => (
                  <FormatOption key={`${format.id}.${spec.key}`} formatId={format.id} spec={spec} />
                ))}
              </Box>

              <Alert severity="info" sx={{ mt: 2 }}>
                Books you already have (same ISBN, or same title and author) are skipped, so it's safe to
                import the same file again.
              </Alert>
              {phase === "importing" && <LinearProgress sx={{ mt: 2 }} />}
            </>
          )}
        </DialogContent>
        <DialogActions>
          {phase === "lookup" ? (
            <Button disabled={stopping} onClick={stopLookup}>
              {stopping ? "Stopping…" : "Stop"}
            </Button>
          ) : (
            <>
              <Button disabled={busy} onClick={close}>Cancel</Button>
              <Button variant="contained" disabled={busy || !format} onClick={chooseAndImport}>
                Choose file…
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={!!report} onClose={() => setReport(null)} fullWidth maxWidth="xs">
        <DialogTitle>{report && `${report.format} import finished`}</DialogTitle>
        <DialogContent>
          {report && <ReportBody report={report.report} lookup={report.lookup} />}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReport(null)}>Done</Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

function LookupProgress({ progress, stopping }: { progress: EnrichProgress | null; stopping: boolean }) {
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  return (
    <>
      <Typography variant="subtitle1">Looking up details…</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {total > 0 ? `${done} of ${plural(total, "book", "books")}` : "Starting…"}
      </Typography>
      <LinearProgress
        variant={total > 0 ? "determinate" : "indeterminate"}
        value={total > 0 ? (done / total) * 100 : 0}
      />
      {progress && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          {progress.updated} updated, {progress.notFound} not found
          {progress.failed > 0 && <>, {progress.failed} failed</>}
        </Typography>
      )}
      <Alert severity="info" sx={{ mt: 2 }}>
        Your books are already imported. {stopping ? "Finishing the lookups in progress…" : "Stopping only skips the lookups that are left."}
      </Alert>
    </>
  );
}

function LookupSummary({ lookup: l }: { lookup: EnrichResult | { error: string } }) {
  if ("error" in l) {
    return <Alert severity="info" sx={{ mt: 2 }}>Details weren't looked up: {l.error}.</Alert>;
  }
  return (
    <Alert severity={l.stopped === "failing" || l.failed > 0 ? "warning" : "info"} sx={{ mt: 2 }}>
      {l.stopped === "user" && <>Stopped after {l.done} of {plural(l.total, "book", "books")}. </>}
      {l.stopped === "failing" && (
        <>Stopped after {l.done} of {plural(l.total, "book", "books")}: the lookups kept failing, so check your connection. </>
      )}
      Details: {plural(l.updated, "book", "books")} updated{l.covers > 0 && <> ({plural(l.covers, "cover", "covers")})</>}
      {l.unchanged > 0 && <>, {l.unchanged} already complete</>}
      {l.notFound > 0 && <>, {l.notFound} not found by any plugin</>}
      {l.noIsbn > 0 && <>, {l.noIsbn} without a usable ISBN</>}
      {l.failed > 0 && <>, {l.failed} failed</>}.
      {l.problems.length > 0 && (
        <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
          {l.problems.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

function ReportBody({
  report: r,
  lookup,
}: {
  report: LibraryImportReport;
  lookup: EnrichResult | { error: string } | null;
}) {
  return (
    <DialogContentText component="div">
      {plural(r.imported, "book", "books")} imported
      {r.skippedDuplicates > 0 && <>, {r.skippedDuplicates} already in your library and skipped</>}
      {r.failed > 0 && <>, {r.failed} couldn't be imported</>}.
      {r.imported > 0 && (
        <>
          <br />
          Added {plural(r.authorsCreated, "author", "authors")}, {r.seriesCreated} series,{" "}
          {plural(r.shelvesCreated, "shelf", "shelves")} and {plural(r.readingsCreated, "reading", "readings")}
          {r.estimatedDates > 0 && <> ({r.estimatedDates} with the date added as an estimated date)</>}.
        </>
      )}
      {r.messages.length > 0 && (
        <Alert severity={r.failed > 0 ? "warning" : "info"} sx={{ mt: 2 }}>
          Details:
          <ul style={{ margin: "4px 0 0", paddingLeft: 20, maxHeight: 200, overflowY: "auto" }}>
            {r.messages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Alert>
      )}
      {lookup && <LookupSummary lookup={lookup} />}
    </DialogContentText>
  );
}

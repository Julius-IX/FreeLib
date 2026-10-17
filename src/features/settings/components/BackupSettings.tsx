import { useState } from "react";
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  LinearProgress, Radio, Typography,
} from "@mui/material";
import { open, save } from "@tauri-apps/plugin-dialog";
import { commands } from "@/lib/commands";
import type { ImportMode, ImportReport } from "@/lib/types";
import { notify } from "@/notifications/notify";
import { Preference, Section } from "./Preferences";

const MODES: { value: ImportMode; label: string; description: string }[] = [
  {
    value: "appendMerge",
    label: "Merge, keep my books",
    description:
      "Adds books, authors, series and tags that aren't in your library yet (matched by ISBN). " +
      "Books you already have keep their current details and cover; the backup's version of them is ignored.",
  },
  {
    value: "overrideMerge",
    label: "Merge, backup wins",
    description:
      "Same as above, but a book that exists in both is replaced by the backup's version " +
      "(details, authors, tags, notes, reading history and cover). Books only you have are kept.",
  },
  {
    value: "fullReplace",
    label: "Full replace",
    description:
      "Deletes everything you have now (library, covers, plugins, settings) and restores the backup exactly.",
  },
];

const defaultBackupName = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `free-lib-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.zip`;
};

const fileLabel = (path: string) => decodeURIComponent(path.split(/[\\/]/).pop() ?? path);

export function BackupSettings() {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>("appendMerge");
  const [report, setReport] = useState<ImportReport | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      // Desktop: a path. Android: a content:// URI from the system file chooser.
      const destination = await save({
        title: "Save backup",
        defaultPath: defaultBackupName(),
        filters: [{ name: "Free Lib backup", extensions: ["zip"] }],
      });
      if (!destination) return; // cancelled
      const b = await commands.backup.createBackup({ destination });
      notify(`Backup saved: ${fileLabel(b.path)}`, { severity: "success", duration: 12000 });
    } catch (e) {
      notify(`Couldn't create the backup: ${String(e)}`, { severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    try {
      const file = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Free Lib backup", extensions: ["zip"] }],
      });
      if (typeof file === "string") {
        setMode("appendMerge");
        setPicked(file);
      }
    } catch (e) {
      notify(`Couldn't open the file picker: ${String(e)}`, { severity: "error" });
    }
  };

  const runImport = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      setReport(await commands.backup.importBackup({ source: picked, mode }));
      setPicked(null);
    } catch (e) {
      notify(`Import failed: ${String(e)}`, { severity: "error", duration: 12000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Backup">
      <Preference
        title="Create backup"
        summary="Save your library, covers, plugins and settings"
        onClick={busy ? undefined : create}
      />
      <Preference
        title="Import backup"
        summary="Restore or merge a backup file"
        onClick={busy ? undefined : pick}
      />
      {busy && !picked && <LinearProgress sx={{ mx: 2 }} />}

      <Dialog open={!!picked} onClose={() => !busy && setPicked(null)} fullWidth maxWidth="sm">
        <DialogTitle>Import backup</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 1, wordBreak: "break-all" }}>
            {picked && fileLabel(picked)}
          </DialogContentText>
          {MODES.map((m) => (
            <Box
              key={m.value}
              onClick={() => !busy && setMode(m.value)}
              sx={{ display: "flex", alignItems: "flex-start", cursor: "pointer", py: 0.5 }}
            >
              <Radio checked={mode === m.value} disabled={busy} sx={{ mt: -0.5 }} />
              <Box>
                <Typography>{m.label}</Typography>
                <Typography variant="body2" color="text.secondary">{m.description}</Typography>
              </Box>
            </Box>
          ))}
          <Alert severity={mode === "fullReplace" ? "error" : "warning"} sx={{ mt: 2 }}>
            {mode === "fullReplace"
              ? "This permanently deletes your current library, covers, plugins and settings. It can't be undone."
              : "The backup's settings replace yours, and plugin files from the backup are added. This can't be undone, so create a backup first if unsure."}
          </Alert>
          {busy && <LinearProgress sx={{ mt: 2 }} />}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setPicked(null)}>Cancel</Button>
          <Button
            disabled={busy}
            color={mode === "fullReplace" ? "error" : "primary"}
            variant="contained"
            onClick={runImport}
          >
            {mode === "fullReplace" ? "Delete and restore" : "Import"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!report} fullWidth maxWidth="xs">
        <DialogTitle>Backup imported</DialogTitle>
        <DialogContent>
          {report && (
            <DialogContentText component="div">
              {report.booksAdded} {report.booksAdded === 1 ? "book" : "books"} added
              {report.booksUpdated > 0 && <>, {report.booksUpdated} replaced</>}
              {report.booksSkipped > 0 && <>, {report.booksSkipped} already existed and were left alone</>}.
              <br />
              {report.authorsAdded} authors, {report.seriesAdded} series, {report.tagsAdded} tags, {report.categoriesAdded} categories, {report.shelvesAdded} shelves,{" "}
              {report.coversCopied} covers and {report.pluginFilesCopied} plugin files added.
              {report.warnings.length > 0 && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  Parts of this backup were missing or couldn't be used:
                  <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                    {report.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </Alert>
              )}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          {/* settings, covers and plugins all changed: reload so every screen starts fresh */}
          <Button onClick={() => window.location.reload()}>Done</Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

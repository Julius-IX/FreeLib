import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, CircularProgress, IconButton, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
import OptionalModal from "@/modal/OptionalModal";
import { isMobile } from "@/util/misc";
import { commands } from "@/lib/commands";
import { notify } from "@/notifications/notify";
import { NotesEditor } from "../book-view/NotesEditor";
import { useBookDetails } from "../book-view/useBookDetails";

// Desktop only: the modal never shrinks below this, however small the window gets.
const MODAL_MIN_WIDTH = 360;
const MODAL_MIN_HEIGHT = 360;
const SAVE_DELAY_MS = 600;

/**
 * Notes for one book. Mobile: a full screen page. Desktop: a modal.
 * Either way it's one surface that saves as you type, no edit/save buttons.
 */
export default function BookNotes() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const { state } = useBookDetails(bookId);
  const title = state.status === "ready" ? state.details.book.title : "";
  const id = bookId !== undefined && /^\d+$/.test(bookId) ? Number(bookId) : null;

  const [text, setText] = useState<string | null>(null); // null = still loading
  const [loadFailed, setLoadFailed] = useState(id === null);

  useEffect(() => {
    if (id === null) return;
    let stale = false;
    commands.db_crud
      .getBookNotes({ bookId: id })
      .then((v) => !stale && setText(v))
      .catch((e) => {
        if (stale) return;
        setLoadFailed(true);
        notify(`Couldn't load notes: ${String(e)}`, { severity: "error" });
      });
    return () => {
      stale = true;
    };
  }, [id]);

  // Debounced autosave. `pending` holds what still needs writing; flush() writes it now.
  const pending = useRef<{ id: number; text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    commands.db_crud
      .updateBookNotes({ bookId: p.id, notes: p.text })
      .catch((e) => notify(`Couldn't save notes: ${String(e)}`, { severity: "error" }));
  }, []);

  const onChange = (value: string) => {
    setText(value);
    if (id === null) return;
    pending.current = { id, text: value };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  };

  useEffect(() => flush, [flush]); // leaving the screen writes whatever is still pending

  const mobile = isMobile();

  return (
    <OptionalModal
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { height: "70vh", minWidth: MODAL_MIN_WIDTH, minHeight: MODAL_MIN_HEIGHT } } }}
    >
      <Box sx={{ height: "100%", minHeight: 0, boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
        <Box
          sx={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            p: 0.5,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <IconButton aria-label={mobile ? "Back" : "Close"} onClick={() => navigate(-1)}>
            {mobile ? <ArrowBackIcon /> : <CloseIcon />}
          </IconButton>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
              Notes
            </Typography>
            {title && (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                {title}
              </Typography>
            )}
          </Box>
        </Box>

        {loadFailed ? (
          <Typography color="text.secondary" sx={{ p: 2 }}>
            Couldn't load this book's notes.
          </Typography>
        ) : text === null ? (
          <Box sx={{ p: 2, display: "flex", justifyContent: "center" }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          // mounted only once the text is loaded, so startEditing is decided from the real value
          <NotesEditor value={text} onChange={onChange} onBlur={flush} startEditing={!mobile || text === ""} />
        )}
      </Box>
    </OptionalModal>
  );
}

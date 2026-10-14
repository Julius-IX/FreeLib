import { useNavigate } from "react-router-dom";
import { Box, Button, IconButton, TextField } from "@mui/material";
import OptionalModal from "@components/OptionalModal";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useContext, useState, useEffect } from "react";
import { isOnMobile } from "@/App";
import { commands } from "@/lib/commands";

type Availability = "idle" | "checking" | "available" | "taken" | "error";

const HELPER_TEXT: Record<Availability, string> = {
  idle: " ", // keep a space so the layout doesn't jump
  checking: "Checking…",
  available: "Name is available",
  taken: "A series with this name already exists",
  error: "Couldn't check availability",
};

export default function NewSeries() {
  const navigate = useNavigate();
  const isMobile = useContext(isOnMobile);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Availability>("idle");

  const trimmed = name.trim();

  useEffect(() => {
    if (!trimmed) {
      setStatus("idle");
      return;
    }

    setStatus("checking");
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        // replace with your real check (API call, lookup in store, etc.)
        const exists = await commands.db.seriesExists({ name: trimmed })
        if (controller.signal.aborted) return; // stale result, ignore
        setStatus(exists ? "taken" : "available");
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  const canCreate = status === "available";

  const handleCreate = () => {
    if (!canCreate) return;
    commands.db_crud.createSeries({ name: trimmed })
    navigate(-1);
  };

  // TODO: selection menu to auto add specific book entries to the series on creation

  return (
    <OptionalModal fullWidth maxWidth="sm">
      <Box sx={{ p: 2, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 2 }}>
        {isMobile && (
          <Box>
            <IconButton aria-label="Back" onClick={() => navigate(-1)}>
              <ArrowBackIcon />
            </IconButton>
          </Box>
        )}

        <TextField
          label="Series Name"
          fullWidth
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
          error={status === "taken" || status === "error"}
          helperText={HELPER_TEXT[status]}
          sx={{
            "& .MuiFormHelperText-root": {
              color: status === "available" ? "success.main" : undefined,
            },
          }}
        />

        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
          <Button onClick={() => navigate(-1)}>Cancel</Button>
          <Button variant="contained" disabled={!canCreate} onClick={handleCreate}>
            Create
          </Button>
        </Box>
      </Box>
    </OptionalModal>
  );
}

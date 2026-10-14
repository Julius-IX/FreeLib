import { RouteObject, Link, useNavigate, useParams } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import { RouteHandle } from "@/tabs";

function LibraryHome() {
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5">Library</Typography>
      <Button component={Link} to="item/1">Open item 1</Button>
    </Box>
  );
}

function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <Box sx={{ p: 2 }}>
      <Button onClick={() => navigate(-1)}>Back</Button>
      <Typography variant="h5">Item {id}</Typography>
      <Button component={Link} to="read">Read (hides bar)</Button>
    </Box>
  );
}

function Reader() {
  const navigate = useNavigate();
  return (
    <Box sx={{ p: 2 }}>
      <Button onClick={() => navigate(-1)}>Close reader</Button>
      <Typography>Full-screen reader, no bar.</Typography>
    </Box>
  );
}

export const libraryRoutes: RouteObject[] = [
  { index: true, element: <LibraryHome /> },
  { path: "item/:id", element: <ItemDetail /> },
  { path: "item/:id/read", element: <Reader />, handle: { hideNav: true } satisfies RouteHandle },
];

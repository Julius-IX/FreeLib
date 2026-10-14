import { RouteObject, useNavigate } from "react-router-dom";
import { Box, Typography, Button } from "@mui/material";
// import { RouteHandle } from "@/tabs";
import FabActionStack from "@components/FabActionStack";
import BookIcon from '@mui/icons-material/Book';
import FolderIcon from '@mui/icons-material/Folder';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { isDesktop, isMobile } from "@/util/misc";
import { RouteHandle } from "@/tabs";
import NewSeries from "./NewSeries";

function LibraryHome() {
  const navigate = useNavigate();
  const actions = [
    { label: 'Add Book', icon: <BookIcon />, onClick: () => navigate(LibraryPath.AddBook) },
    { label: 'New Series', icon: <FolderIcon />, onClick: () => navigate(LibraryPath.NewSeries) },
  ];
  if (isMobile()) {
    actions.splice(1, 0, { label: 'Scan Book', icon: <QrCodeScannerIcon />, onClick: () => navigate(LibraryPath.Scan) });
  }

  return (
    <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <Typography variant="h5">Library</Typography>
      <FabActionStack
        actions={actions}
      />
    </Box>
  );
}

function ScanBook() {
  const navigate = useNavigate();
  return (
    <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <Typography variant="h5">Scan Book</Typography>
      <Button variant="outlined" onClick={() => navigate(-1)}> Back </Button>
    </Box>
  );
}

function AddBook() {
  const navigate = useNavigate();
  return (
    <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <Typography variant="h5">Add Book</Typography>
      <Button variant="outlined" onClick={() => navigate(-1)}> Back </Button>
    </Box>
  );
}

export const LibraryPath = {
  Scan: "scan",
  NewSeries: "new-series",
  AddBook: "add-book",
} as const;

export type LibraryPath = (typeof LibraryPath)[keyof typeof LibraryPath];

export const libraryRoutes: RouteObject[] = [
  { index: true, element: <LibraryHome /> },
  { path: LibraryPath.Scan, element: <ScanBook />, handle: { hideNav: isMobile() } satisfies RouteHandle },
  { path: LibraryPath.NewSeries, element: <NewSeries />, handle: { modal: isDesktop() } satisfies RouteHandle },
  { path: LibraryPath.AddBook, element: <AddBook />, handle: { hideNav: isMobile() } satisfies RouteHandle },
];

import { RouteObject } from "react-router-dom";
import { Box, Typography } from "@mui/material";

function BrowseHome() {
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5">Browse</Typography>
    </Box>
  );
}

export const browseRoutes: RouteObject[] = [
  { index: true, element: <BrowseHome /> },
];

import { createHashRouter, Navigate } from "react-router-dom";
import AppLayout from "./AppLayout";
import { tabs } from "./tabs";

export const router = createHashRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to={`/${tabs[0].id}`} replace /> },
      ...tabs.map((t) => ({ path: t.id, children: t.routes })),
    ],
  },
]);

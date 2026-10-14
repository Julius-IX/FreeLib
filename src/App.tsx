import AppLayout from "./AppLayout";
import { SnackbarHost } from "./SnackbarHost";
import { createContext } from "react";
import { isMobile } from "@util/misc";

export const isOnMobile = createContext(isMobile());

export default function App() {
  return (
    <>
      <isOnMobile.Provider value={isMobile()}>
        <AppLayout />
        <SnackbarHost />
      </isOnMobile.Provider>
    </>
  );
}

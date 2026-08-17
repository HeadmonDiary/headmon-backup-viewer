import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import BackupViewer from "../app/BackupViewer";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) throw new Error("The backup viewer root is missing.");

createRoot(root).render(
  <StrictMode>
    <BackupViewer />
  </StrictMode>,
);

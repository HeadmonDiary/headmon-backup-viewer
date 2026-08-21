import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import BackupViewer from "../app/BackupViewer";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) throw new Error("The backup viewer root is missing.");

if (window.self !== window.top) {
  const message = document.createElement("main");
  const heading = document.createElement("h1");
  const explanation = document.createElement("p");
  message.className = "framing-warning";
  heading.textContent = "Open the backup viewer directly";
  explanation.textContent =
    "For your privacy, Headmon does not run the backup viewer inside another website.";
  message.append(heading, explanation);
  root.replaceChildren(message);
} else {
  createRoot(root).render(
    <StrictMode>
      <BackupViewer />
    </StrictMode>,
  );
}

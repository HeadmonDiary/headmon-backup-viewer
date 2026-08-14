import type { Metadata } from "next";
import BackupViewer from "./BackupViewer";

export const metadata: Metadata = {
  title: "Headmon Backup Studio",
  description:
    "Privately browse and correct a Headmon full backup on your device.",
};

export default function Home() {
  return <BackupViewer />;
}

import type { Metadata } from "next";
import BackupViewer from "./BackupViewer";

export const metadata: Metadata = {
  title: "Backup viewer | Headmon",
  description:
    "Privately browse, repair, compare, and report on Headmon backups on your device.",
};

export default function Home() {
  return <BackupViewer />;
}

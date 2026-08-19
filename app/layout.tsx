import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Backup viewer | Headmon",
  description: "A device-local workbench for viewing, repairing, comparing, and reporting on Headmon backups.",
  icons: {
    icon: "/headmon-icon.png",
    shortcut: "/headmon-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Headmon Backup Studio",
  description: "A local-only viewer and editor for Headmon full backups.",
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

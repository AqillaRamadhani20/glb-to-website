import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Terminal 01 — 3D Navigator",
  description: "Peta terminal 3D interaktif berbasis data GLB.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Videoeditor47", description: "Kostenloser Video-Recap direkt auf deinem Handy" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="de"><body>{children}</body></html>; }
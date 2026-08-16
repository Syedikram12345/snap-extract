import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SnapExtract — Screenshot to Clean Text & Code",
  description: "Extract clean text, code, tables and URLs from screenshots. Paste or upload an image and copy the result instantly.",
  keywords: [
    "screenshot to text",
    "image to text",
    "screenshot to code",
    "OCR",
    "extract text from image"
  ],
  openGraph: {
    title: "SnapExtract — Screenshot to Clean Text & Code",
    description: "Turn screenshots into clean, usable text and code.",
    type: "website"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

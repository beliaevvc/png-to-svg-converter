import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PNG to SVG Converter — Free Online Vectorizer",
  description:
    "Convert PNG and JPG images to SVG vectors quickly and easily. Free online tool with advanced settings for perfect vector conversion.",
  keywords: ["png to svg", "image vectorizer", "convert png", "svg converter", "trace image"],
  authors: [{ name: "0:LimitX" }],
  openGraph: {
    title: "PNG to SVG Converter — Free Online Vectorizer",
    description: "Convert images to vectors quickly and easily. Free online tool.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

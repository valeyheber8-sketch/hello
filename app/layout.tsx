import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Check Now",
  description: "Check Now",
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

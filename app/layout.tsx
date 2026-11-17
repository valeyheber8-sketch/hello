import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Check Now | BNB Smart Chain USDT Approval",
  description:
    "Review your BNB Smart Chain USDT balance, allowance, and fixed 1 USDT approval before authorizing a wallet transaction.",
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

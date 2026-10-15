import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kairos",
  description: "A coursework dashboard for assignments and deadlines.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}

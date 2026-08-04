import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoxDesk",
  description:
    "A browser voice concierge that answers from a controlled knowledge base and books a real discovery call during the conversation.",
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

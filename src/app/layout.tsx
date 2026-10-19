import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UofT Class & Room Finder",
  description:
    "Find UofT classes and classrooms: live classroom availability from the UTM space database and complete course schedules from the UofT timetable API.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

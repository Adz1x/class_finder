import type { Metadata } from "next";
import "./globals.css";

const DESCRIPTION =
  "Find UofT classes and classrooms across Mississauga, St. George and Scarborough: published classroom availability, complete course schedules, and room-level search.";

export const metadata: Metadata = {
  title: "UofT Class & Room Finder",
  description: DESCRIPTION,
  openGraph: {
    title: "UofT Class & Room Finder",
    description: DESCRIPTION,
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "UofT Class & Room Finder" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "UofT Class & Room Finder",
    description: DESCRIPTION,
    images: ["/og.png"],
  },
  metadataBase: new URL("https://uoftclassfinder.app"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        {/* Font Awesome is vendored locally (public/font-awesome) so the page
         * makes no third-party request at runtime. */}
        <link rel="stylesheet" href="/font-awesome/css/all.min.css" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

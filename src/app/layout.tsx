import type { Metadata } from "next";
import "./globals.css";

const DESCRIPTION =
  "Find UofT classes and classrooms across Mississauga, St. George and Scarborough: published classroom availability, complete course schedules, and room-level search.";

export const metadata: Metadata = {
  // Where the project lives, so the social preview image resolves to an
  // absolute URL rather than to localhost.
  metadataBase: new URL("https://adz1x.github.io/class_finder"),
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

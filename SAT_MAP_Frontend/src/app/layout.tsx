import type { Metadata, Viewport } from "next";
import ErrorBoundary from "@/components/ErrorBoundary";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

export const viewport: Viewport = {
  themeColor: "#0072CE",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  colorScheme: "dark",
};

export const metadata: Metadata = {
  title: {
    default: "LTmap — Intelligence Platform",
    template: "%s | L&T Intelligence",
  },
  description:
    "Track satellites and maritime vessels on an interactive 3D globe.",
  keywords: [
    "intelligence platform",
    "geospatial intelligence",
    "satellite tracking",
    "maritime vessel tracking",
    "LTmap",
    "L&T",
  ],
  robots: { index: true, follow: true },
  icons: { icon: "data:," },
  manifest: "/site.webmanifest",
  openGraph: {
    title: "LTmap — Satellite & Maritime Tracking",
    description:
      "Track satellites and maritime intelligence feeds on an interactive 3D map.",
    type: "website",
    siteName: "L&T",
    locale: "en_US",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "L&T",
    "mobile-web-app-capable": "yes",
    "msapplication-TileColor": "#06060C",
    "msapplication-config": "none",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body className="antialiased">
        <ErrorBoundary name="L&T Core">{children}</ErrorBoundary>
      </body>
    </html>
  );
}

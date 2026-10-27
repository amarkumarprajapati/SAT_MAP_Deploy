import type { Metadata, Viewport } from "next";
import ErrorBoundary from '@/components/ErrorBoundary';
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

const SITE_URL = "https://osirisai.live";
const SITE_NAME = "L&T";
const SITE_TITLE = "LTmap — Intelligence Platform | Military Aircraft, Satellite & Maritime Tracking";
const SITE_DESCRIPTION = "Global intelligence platform. Track live military aircraft, satellites, and maritime vessels on an interactive 3D globe.";

export const viewport: Viewport = {
  themeColor: "#0072CE",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  colorScheme: "dark",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s | L&T Intelligence",
  },
  description: SITE_DESCRIPTION,
  keywords: [
    // Intelligence Platform
    "intelligence platform", "global intelligence",
    "geospatial intelligence", "GEOINT", "SIGINT", "real-time tracking",
    "intelligence dashboard",
    
    // Tracking & Data
    "military flight tracker", "military aircraft tracking", "ADS-B military", "live flight radar",
    "satellite tracking", "ISS tracker", "maritime vessel tracking",
    
    // Brand
    "ltmap", "lt-map", "LTmap", "L&T",
  ],
  authors: [{ name: "L&T Project", url: SITE_URL }],
  creator: "L&T Project",
  publisher: "L&T Project",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "data:,",
  },
  manifest: "/site.webmanifest",
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    title: "LTmap — Live Military Flights, Satellites & Maritime Tracking",
    description: "Track military aircraft, satellites, and maritime intelligence feeds on an interactive 3D map.",
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: SITE_URL,
    images: [
      {
        url: `${SITE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "LTmap — Intelligence Platform",
        type: "image/png",
      },
    ],
  },
  category: "technology",
  classification: "Intelligence & Security",
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "L&T",
    "mobile-web-app-capable": "yes",
    "msapplication-TileColor": "#06060C",
    "msapplication-config": "none",
  },
};

// JSON-LD Structured Data
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "L&T — Global Intelligence Platform",
  alternateName: ["L&T", "L&TAI", "L&T Intelligence"],
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  applicationCategory: "SecurityApplication",
  operatingSystem: "Web",
  browserRequirements: "Requires a modern web browser",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
  },
  featureList: [
    "Nmap port scanning from the browser — no install required",
    "DNS record lookup (A, AAAA, MX, NS, TXT, CNAME)",
    "WHOIS domain registration lookup",
    "SSL/TLS certificate transparency search",
    "BGP routing & ASN lookup",
    "IP geolocation & threat intelligence",
    "Real-time military flight tracking via ADS-B",
    "Satellite tracking (including ISS)",
    "Maritime vessel & chokepoints tracking",
    "Cyber threat & CVE intelligence",
    "GPS jamming detection",
    "Defense & commodity market tracking",
    "Interactive 3D globe with day/night cycle",
    "Region intelligence dossier reports",
  ],
  screenshot: `${SITE_URL}/og-image.png`,
  author: {
    "@type": "Organization",
    name: "L&T Project",
    url: SITE_URL,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr">
      <head>
        <link rel="icon" href="data:," />
        <link rel="canonical" href={SITE_URL} />
        
        {/* JSON-LD Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />

      </head>
      <body className="antialiased">
        <ErrorBoundary name="L&T Core">
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}

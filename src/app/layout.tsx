import type { Metadata, Viewport } from "next";
import { Sora, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SplashScreen } from "@/components/splash-screen";

// Runs before first paint: once the launch splash has played in this browser
// session, hide it for good so navigating or reloading never replays it.
// (Same sessionStorage key as src/components/splash-screen.tsx.)
const splashSkipScript = `try{if(sessionStorage.getItem("th-splash")==="1")document.documentElement.dataset.splash="skip"}catch(e){}`;

// viewportFit: cover lets env(safe-area-inset-bottom) resolve on iOS, so the
// fixed bottom tab bar sits above the home indicator instead of under it.
export const viewport: Viewport = {
  viewportFit: "cover",
};

// Sora is the v2 design's typeface (design-mockups/hallway-v2.html). Loaded at
// build time via next/font — self-hosted, no runtime Google request. Geist Mono
// stays for student IDs and other tabular identifiers.
const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tudor Hall",
  description: "Resident management for Tudor Hall staff.",
  // iOS home screen: the label comes from apple-mobile-web-app-title, the
  // icon from the apple-touch-icon link (180x180, generated from
  // public/icon-source.png on a navy square).
  appleWebApp: { title: "Tudor Hall" },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sora.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: splashSkipScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <SplashScreen />
        {children}
      </body>
    </html>
  );
}

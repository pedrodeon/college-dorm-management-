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
// themeColor tints the browser/status chrome navy so it matches the splash.
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#0a1633",
};

// iOS home-screen launch images. iOS paints its own blank launch screen
// (white, or black in dark mode) until the web content loads unless one of
// these matches the device. They are flat canvas navy, with no seal, so the
// hand-off into the orbit splash has no jump. Portrait iPhones only. iOS
// caches these, so re-add the app to the Home Screen to pick up changes.
const IPHONE_LAUNCH_SIZES: Array<[number, number, number]> = [
  [440, 956, 3],
  [402, 874, 3],
  [430, 932, 3],
  [393, 852, 3],
  [390, 844, 3],
  [375, 812, 3],
  [414, 896, 3],
  [414, 896, 2],
  [375, 667, 2],
  [428, 926, 3],
  [420, 912, 3],
];
const startupImage = IPHONE_LAUNCH_SIZES.map(([w, h, r]) => ({
  url: `/splash/navy-${w}x${h}@${r}x.png`,
  media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
}));

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
  appleWebApp: { title: "Tudor Hall", startupImage },
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
        {/* Navy from the very first paint, even before globals.css arrives. */}
        <style>{`html,body{background:#0a1633}`}</style>
        <script dangerouslySetInnerHTML={{ __html: splashSkipScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <SplashScreen />
        {children}
      </body>
    </html>
  );
}

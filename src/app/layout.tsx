import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bhoomi CRM",
  description: "Real Estate CRM Portal",
  icons: {
    icon: "/assets/logobrowser_trans.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

import { AttendanceProvider } from "@/components/AttendanceContext";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import CapacitorBackButton from "@/components/CapacitorBackButton";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning because the script below stamps data-crm-theme
    // onto <html> before React hydrates, so the client's attributes will not
    // match the server-rendered markup. That mismatch is the intended
    // behaviour — the server cannot know the theme — and this scopes the
    // suppression to this one element rather than silencing it app-wide.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Runs before the first paint, so a dark-mode user does not get a white
          flash on every navigation. It has to be inline and synchronous: an
          external or deferred script runs after paint, which is the whole
          problem. See lib/theme.ts for the script itself.

          The content is a constant defined in our own source — no user input
          reaches it — which is what makes dangerouslySetInnerHTML safe here.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <CapacitorBackButton />
        <AttendanceProvider>
          {children}
        </AttendanceProvider>
      </body>
    </html>
  );
}

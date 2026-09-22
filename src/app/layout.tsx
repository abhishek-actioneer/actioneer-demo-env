import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { LayoutShell } from "@/components/layout-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { AgenationToolbar } from "@/components/agentation-toolbar";
import { ClerkDevStrip } from "@/components/clerk-dev-strip";
import { PostHogProvider } from "@/components/posthog-provider";
import { Suspense } from "react";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "actioneer",
  description: "Growth engine for apps",
  openGraph: {
    title: "actioneer",
    description: "Growth engine for apps",
  },
};

const hideNextDevOverlay =
  process.env.NODE_ENV === "production" ||
  Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_PUBLIC_DOMAIN ||
      process.env.VERCEL ||
      process.env.RENDER
  );

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-hide-nextjs-devtools={hideNextDevOverlay ? "true" : undefined}
      suppressHydrationWarning
    >
      <body
        className={`${inter.variable} ${geistMono.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        <ClerkProvider
          appearance={{
            variables: {
              colorPrimary: "#171714",
              colorBackground: "#fbfbf9",
              colorText: "#171714",
              colorTextSecondary: "#74746d",
              colorInputBackground: "#ffffff",
              colorInputText: "#171714",
              colorNeutral: "#74746d",
              borderRadius: "0.0625rem",
              fontFamily: "Inter, sans-serif",
            },
          }}
        >
          <ThemeProvider>
            <Suspense fallback={null}>
              <PostHogProvider>
                <LayoutShell>{children}</LayoutShell>
              </PostHogProvider>
            </Suspense>
            <Toaster position="bottom-right" />
            <AgenationToolbar />
            <ClerkDevStrip />
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}

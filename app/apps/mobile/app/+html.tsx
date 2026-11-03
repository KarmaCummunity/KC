import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />

        {/* PWA / home-screen — high-res icons for Android/Chrome live in public/manifest.json */}
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/pwa-icon-192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/pwa-icon-512.png" />

        {/* iOS standalone display */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="KC" />

        {/* Theme colour for Android Chrome — kept literal so the static head has no app imports;
            brandGuard.test pins it to the `primaryVivid` token. */}
        <meta name="theme-color" content="#F97316" /> {/* brand-guard-allow: static HTML head, pinned by test */}

        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}

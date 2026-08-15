import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useEffect } from "react";
import { registerSW } from "virtual:pwa-register";
import { InstallPrompt } from "./components/install-prompt";
import "./styles.css";
import "./lib/i18n";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="theme-color" content="#f5f5f7" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="KOAN" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon-180.png" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  useEffect(() => {
    registerSW({ immediate: true });
    const theme = localStorage.getItem("koan-theme") ?? "system";
    document.documentElement.classList.toggle(
      "dark",
      theme === "dark" ||
        theme === "system" &&
          matchMedia("(prefers-color-scheme: dark)").matches,
    );
  }, []);
  return (
    <>
      <Outlet />
      <InstallPrompt />
    </>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-6">
      <section className="surface max-w-lg text-center">
        <span className="eyebrow">KOAN</span>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Something went wrong.
        </h1>
        <p className="mt-3 text-muted">
          {error instanceof Error
            ? error.message
            : "The application could not continue."}
        </p>
        <a className="button-primary mt-6 inline-flex" href="/">Return home</a>
      </section>
    </main>
  );
}

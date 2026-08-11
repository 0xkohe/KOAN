import { Link } from "react-router";
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-6">
      <div className="text-center">
        <span className="eyebrow">404</span>
        <h1 className="mt-3 text-4xl font-semibold">Page not found</h1>
        <Link className="button-primary mt-6 inline-flex" to="/">
          Return home
        </Link>
      </div>
    </main>
  );
}

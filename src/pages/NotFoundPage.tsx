import { Link } from "react-router-dom";
import { Logo } from "../components/branding/Logo";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-6 text-center font-body">
      <Logo />
      <p className="font-display text-xl font-semibold text-ink">Page not found</p>
      <p className="text-sm text-inkmuted">The page you're looking for doesn't exist or has moved.</p>
      <Link to="/" className="font-body text-sm font-medium text-copper hover:underline">
        Go home
      </Link>
    </div>
  );
}

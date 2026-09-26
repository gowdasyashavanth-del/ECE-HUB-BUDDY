import { Logo } from "../components/branding/Logo";

// Shown when no Supabase project is connected yet. This is expected in
// this phase — the design/migrations were reviewed and approved, but
// per your instructions a new Supabase project has not been created or
// connected. This screen exists so the app is genuinely viewable right
// now rather than a blank crash, and says exactly what to do next.
export function ConfigNeededPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 text-center font-body">
      <Logo />
      <div className="mt-8 max-w-md rounded-lg border border-line bg-panel p-6">
        <p className="font-display text-lg font-semibold text-ink">No Supabase project connected yet</p>
        <p className="mt-2 text-sm text-inkmuted">
          This is expected — the app shell runs standalone until a new ECE Hub Buddy Supabase
          project is created and its keys are added.
        </p>
        <ol className="mt-4 space-y-2 text-left font-mono text-xs text-ink/80">
          <li>1. Create a new Supabase project (not the Bioverse one).</li>
          <li>2. Run the SQL files in <span className="text-copper">supabase/migrations/</span>, in numeric order.</li>
          <li>3. Copy <span className="text-copper">.env.example</span> to <span className="text-copper">.env</span> and fill in the project URL + anon key.</li>
          <li>4. Restart the dev server.</li>
        </ol>
      </div>
    </div>
  );
}

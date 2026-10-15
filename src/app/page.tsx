import Link from "next/link";

export default function HomePage(){
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <div className="max-w-2xl">
        <p className="mb-3 text-sm font-medium text-[var(--muted)]">Coursework, in one place</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Kairos</h1>
        <p className="mt-5 text-lg leading-8 text-[var(--muted)]">
          Track assignments from Canvas, Gradescope, and Ed, then optionally sync deadlines to your calendar.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/sign-in?returnTo=/upcoming"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--accent)] px-4 py-2.5 font-medium text-white"
          >
            Sign in
          </Link>
          <Link
            href="/sign-in?returnTo=/upcoming"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 font-medium"
          >
            Open Kairos
          </Link>
        </div>
        <p className="mt-8 text-sm leading-6 text-[var(--muted)]">
          Kairos is an independent student project and is not affiliated with or endorsed by the University of Washington.
        </p>
        <nav aria-label="Legal" className="mt-5 flex gap-4 text-sm">
          <Link href="/privacy" className="underline underline-offset-4">Privacy</Link>
          <Link href="/terms" className="underline underline-offset-4">Terms</Link>
        </nav>
      </div>
    </main>
  );
}

import Link from "next/link";
import type {Metadata} from "next";

export const metadata:Metadata={
  title:"Kairos — coursework and deadline dashboard",
  description:"UW-first assignment dashboard for Canvas, Gradescope, and Ed. Sign in with Google or Microsoft; calendar connections are optional.",
  alternates:{canonical:"https://mykairos.me/"},
};

export default function HomePage(){
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <div className="max-w-2xl">
        <p className="mb-3 text-sm font-medium text-[var(--muted)]">Coursework, in one place</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Kairos</h1>
        <p className="mt-5 text-lg leading-8 text-[var(--muted)]">
          Kairos is an assignment dashboard that brings coursework from Canvas, Gradescope, and Ed into one place.
          See upcoming deadlines, browse your assignment calendar, and check submission status and published grades where available.
        </p>
        <p className="mt-4 leading-7 text-[var(--muted)]">
          UW-first, and open to students signing in with Google or Microsoft accounts.
          You do not need a University of Washington identity to sign in; source access still depends on your own courses and accounts.
          The Firefox Canvas connector currently supports canvas.uw.edu.
        </p>
        <p className="mt-4 leading-7 text-[var(--muted)]">
          Calendar connections are optional and separate from sign-in. After connecting your coursework sources,
          you can choose to publish deadline copies to Google Calendar, Outlook / Microsoft 365, or Apple iCloud Calendar.
          Calendar edits do not change your coursework at its source.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/sign-in?returnTo=/upcoming"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--accent)] px-4 py-2.5 font-medium"
            style={{color:"var(--accent-foreground)"}}
          >
            Sign in with Google or Microsoft
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
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          The hosted service is under active development. Public beta launch and a Mozilla-signed Firefox listing remain pending;
          source availability and provider consent may limit access.
        </p>
        <nav aria-label="Legal and contact" className="mt-5 flex flex-wrap gap-4 text-sm">
          <Link href="/privacy" className="underline underline-offset-4">Privacy</Link>
          <Link href="/terms" className="underline underline-offset-4">Terms</Link>
          <Link href="/support" className="underline underline-offset-4">Support</Link>
          <Link href="/security" className="underline underline-offset-4">Security</Link>
        </nav>
      </div>
    </main>
  );
}

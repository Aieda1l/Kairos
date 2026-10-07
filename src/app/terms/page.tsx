import Link from "next/link";

export default function TermsPage(){
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm underline underline-offset-4">← Kairos</Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Terms</h1>
      <div className="mt-6 space-y-4 leading-7 text-[var(--muted)]">
        <p>Use Kairos only with accounts, coursework, and calendar data you are authorized to access.</p>
        <p>Kairos is provided during active development and may change, become unavailable, or require reconnection as the service evolves.</p>
        <p>Kairos is an independent student project and is not affiliated with or endorsed by the University of Washington.</p>
      </div>
    </main>
  );
}

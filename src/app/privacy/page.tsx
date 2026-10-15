import Link from "next/link";

export default function PrivacyPage(){
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm underline underline-offset-4">← Kairos</Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Privacy</h1>
      <div className="mt-6 space-y-4 leading-7 text-[var(--muted)]">
        <p>Kairos stores the account, coursework, settings, source connections, and calendar connection data needed to provide the service.</p>
        <p>Sensitive source and calendar credentials are encrypted by Kairos before they are stored. Kairos does not need your Canvas or Gradescope password.</p>
        <p>This notice describes the hosted foundation during development and may be updated before public beta.</p>
      </div>
    </main>
  );
}

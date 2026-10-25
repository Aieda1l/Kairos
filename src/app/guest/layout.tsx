import {notFound} from "next/navigation";
import type {ReactNode} from "react";
import {getGuestEnabled} from "@/lib/guest/server/feature";
import {GuestProvider} from "@/features/guest/guest-provider";
import {GuestShell} from "@/features/guest/guest-shell";

export const dynamic="force-dynamic";
export default async function GuestLayout({children}:{children:ReactNode}) {
  if(!await getGuestEnabled())notFound();
  return <GuestProvider><GuestShell>{children}</GuestShell></GuestProvider>;
}

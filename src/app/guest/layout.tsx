import {notFound} from "next/navigation";
import type {ReactNode} from "react";
import {getGuestEnabled} from "@/lib/guest/server/feature";
import {GuestProvider} from "@/features/guest/guest-provider";
import {GuestShell} from "@/features/guest/guest-shell";
import {GuestSourcesProvider} from "@/features/guest/guest-sources-provider";
import {getGuestPublicSiteKey} from "@/lib/guest/server/public-config";

export const dynamic="force-dynamic";
export default async function GuestLayout({children}:{children:ReactNode}) {
  if(!await getGuestEnabled())notFound();
  const siteKey=await getGuestPublicSiteKey();
  return <GuestProvider><GuestSourcesProvider siteKey={siteKey}><GuestShell>{children}</GuestShell></GuestSourcesProvider></GuestProvider>;
}

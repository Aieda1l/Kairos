import "server-only";
import type {LegacyDatabase} from "@/lib/db/legacy-types";
import type {UserScope} from "@/lib/auth/user-scope";
import type {CalendarAdapterFactory} from "@/lib/calendar/adapter";
import {createCalendarAdapterFactory} from "@/lib/calendar/provider-factory";
import {reconcileAllCalendars} from "@/lib/calendar/reconcile";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import type {CredentialKeyring} from "@/lib/security/credential-cipher";

type PostSourceOptions={
  defer:boolean;
  changed:boolean;
  adapterFactory?:CalendarAdapterFactory;
};

export function reconcileCalendarsAfterSourceWrite(
  db:LegacyDatabase,
  options:PostSourceOptions,
):Promise<void>;
export function reconcileCalendarsAfterSourceWrite(
  db:D1DatabaseLike,
  scope:UserScope,
  keyring:CredentialKeyring,
  options:PostSourceOptions,
):Promise<void>;
export async function reconcileCalendarsAfterSourceWrite(
  db:LegacyDatabase|D1DatabaseLike,
  arg2:PostSourceOptions|UserScope,
  arg3?:CredentialKeyring,
  arg4?:PostSourceOptions,
):Promise<void>{
  if("defer" in arg2){
    if(arg2.defer||!arg2.changed)return;
    try{
      await reconcileAllCalendars(db as LegacyDatabase,{
        adapterFactory:arg2.adapterFactory??createCalendarAdapterFactory(
          db as LegacyDatabase,
        ),
      });
    }catch{
      // Source writes remain authoritative.
    }
    return;
  }

  const options=arg4!;
  if(options.defer||!options.changed)return;
  // Hosted source requests never fan out into calendar provider work. Dashboard
  // reads expose the latest source completion; the open browser reconciles each
  // destination through its own admitted invocation after the source refresh.
}

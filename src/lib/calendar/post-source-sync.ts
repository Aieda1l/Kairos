import "server-only";
import type Database from "better-sqlite3";
import {createCalendarAdapterFactory} from "@/lib/calendar/provider-factory";
import {reconcileAllCalendars} from "@/lib/calendar/reconcile";

export async function reconcileCalendarsAfterSourceWrite(
  db:Database.Database,
  options:{defer:boolean;changed:boolean},
):Promise<void>{
  if(options.defer||!options.changed)return;
  try{
    await reconcileAllCalendars(db,{
      adapterFactory:createCalendarAdapterFactory(db),
    });
  }catch{
    // Source writes remain authoritative. Reconciliation records provider
    // health when possible and must never turn a successful pull into failure.
  }
}

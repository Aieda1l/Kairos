import {expect,it} from "vitest";
import {openDatabase} from "@/lib/db/client";
import {migrate} from "@/lib/db/migrate";
import {SettingsRepository} from "@/lib/db/repositories/settings";

it("persists valid timezone settings",()=>{
  const db=openDatabase(":memory:");
  migrate(db);
  const repo=new SettingsRepository(db);
  expect(repo.getTimeZone()).toBe("America/Los_Angeles");
  repo.setTimeZone("UTC");
  expect(repo.getTimeZone()).toBe("UTC");
  expect(()=>repo.setTimeZone("bad-zone")).toThrow();
  db.close();
});

it("defaults to hiding submitted calendar assignments and persists the preference",()=>{
  const db=openDatabase(":memory:");
  migrate(db);
  const repo=new SettingsRepository(db);
  expect(repo.getCalendarHideSubmitted()).toBe(true);
  repo.setCalendarHideSubmitted(false);
  expect(repo.getCalendarHideSubmitted()).toBe(false);
  repo.setCalendarHideSubmitted(true);
  expect(repo.getCalendarHideSubmitted()).toBe(true);
  db.close();
});

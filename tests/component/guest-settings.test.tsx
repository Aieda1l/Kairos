// @vitest-environment jsdom
import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {expect,it,vi} from "vitest";
import {GuestProvider} from "@/features/guest/guest-provider";
import {GuestSettings} from "@/features/guest/guest-settings";
import {guestStoreFake} from "../helpers/guest-store-fake";
it("saves guest timezone without changing filters or calling account settings",async()=>{
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("unexpected network");}));const fake=guestStoreFake();
  render(<GuestProvider storeFactory={async()=>fake.store}><GuestSettings/></GuestProvider>);
  const zone=await screen.findByLabelText("Display timezone");await userEvent.clear(zone);await userEvent.type(zone,"Europe/London");await userEvent.click(screen.getByRole("button",{name:"Save timezone"}));
  await waitFor(async()=>expect((await fake.store.read()).preferences).toMatchObject({timeZone:"Europe/London",filters:{course:"",source:"",search:""}}));expect(fetch).not.toHaveBeenCalled();expect(screen.getByRole("button",{name:"Toggle theme"})).toBeVisible();
  expect(await screen.findByText("Timezone saved in this browser.")).toBeVisible();
});

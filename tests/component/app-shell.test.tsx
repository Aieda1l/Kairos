// @vitest-environment jsdom
import {render,screen} from "@testing-library/react";import userEvent from "@testing-library/user-event";import {expect,it} from "vitest";import {AppSidebar} from "@/components/app-sidebar";
import {MobileNav} from "@/components/mobile-nav";
it("brands the dashboard as Kairos and exposes all primary destinations",async()=>{const user=userEvent.setup();render(<AppSidebar/>);expect(screen.getByText("Kairos")).toBeInTheDocument();for(const label of ["Upcoming","Calendar","All Assignments","Sources","Settings"])expect(screen.getByRole("link",{name:label})).toBeInTheDocument();const toggle=screen.getByRole("button",{name:"Collapse sidebar"});await user.click(toggle);expect(screen.getByRole("button",{name:"Expand sidebar"})).toBeInTheDocument();});
it("keeps the desktop sidebar anchored to the viewport while content scrolls",()=>{const{container}=render(<AppSidebar/>);const sidebar=container.querySelector("aside");expect(sidebar).toHaveClass("md:sticky","md:top-0","md:h-screen","md:overflow-y-auto");});
it("keeps sign out accessible when the desktop sidebar is expanded or collapsed",async()=>{
  const user=userEvent.setup();
  render(<AppSidebar/>);
  expect(screen.getByRole("button",{name:"Sign out"})).toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"Collapse sidebar"}));
  expect(screen.getByRole("button",{name:"Sign out"})).toBeInTheDocument();
});
it("offers sign out in the mobile navigation menu",async()=>{
  const user=userEvent.setup();
  render(<MobileNav/>);
  await user.click(screen.getByRole("button",{name:"Open navigation"}));
  expect(screen.getByRole("button",{name:"Sign out"})).toBeInTheDocument();
});

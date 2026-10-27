// @vitest-environment jsdom
import {act,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,expect,it,vi} from "vitest";
import {GuestVerification} from "@/features/guest/guest-verification";

const script=vi.hoisted(()=>({ready:()=>{}}));
vi.mock("next/script",()=>({default:({onReady}:{onReady:()=>void})=>{script.ready=onReady;return null;}}));
beforeEach(()=>{vi.stubGlobal("fetch",vi.fn(()=>{throw Error("Unexpected network");}));});
it("renders a guest-only compact challenge and requires deliberate continue with a fresh proof",async()=>{
  let options:Record<string,unknown>={};const remove=vi.fn();
  vi.stubGlobal("turnstile",{render:vi.fn((_el,opts)=>{options=opts;return "guest-widget";}),remove,reset:vi.fn()});
  const proof=vi.fn(),cancel=vi.fn();const view=render(<GuestVerification siteKey="public-only" onProof={proof} onCancel={cancel}/>);
  await act(async()=>script.ready());expect(options).toMatchObject({sitekey:"public-only",action:"guest_sync",size:"compact","response-field":false});
  expect(screen.getByRole("button",{name:"Verify and continue"})).toBeDisabled();
  await act(async()=>{(options.callback as (t:string)=>void)("fresh-proof");});expect(proof).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button",{name:"Verify and continue"}));expect(proof).toHaveBeenCalledWith("fresh-proof");
  await waitFor(()=>expect(screen.getByRole("button",{name:"Verify and continue"})).toBeDisabled());
  await userEvent.click(screen.getByRole("button",{name:"Cancel verification"}));expect(cancel).toHaveBeenCalledOnce();view.unmount();expect(remove).toHaveBeenCalledWith("guest-widget");
  expect(screen.queryByText(/Google|Microsoft|sign in/i)).not.toBeInTheDocument();
});
it("expires proof and never submits it automatically on widget errors",async()=>{
  let options:Record<string,unknown>={};vi.stubGlobal("turnstile",{render:(_el:HTMLElement,opts:Record<string,unknown>)=>{options=opts;return "w";},remove:vi.fn(),reset:vi.fn()});
  const proof=vi.fn();render(<GuestVerification siteKey="public-only" onProof={proof} onCancel={vi.fn()}/>);await act(async()=>script.ready());
  await act(async()=>{(options.callback as (v:string)=>void)("token");(options["expired-callback"] as ()=>void)();});expect(screen.getByRole("button",{name:"Verify and continue"})).toBeDisabled();expect(proof).not.toHaveBeenCalled();
});

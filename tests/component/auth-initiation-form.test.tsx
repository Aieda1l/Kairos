// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {AuthInitiationForm} from "@/features/auth/auth-initiation-form";

vi.mock("next/script",()=>({default:({onReady}:{onReady:()=>void})=>{queueMicrotask(onReady);return null;}}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("managed auth initiation widget",()=>{
  it("submits only a freshly solved token and resets a spent token after rejection",async()=>{
    let options:Record<string,unknown>={};
    const reset=vi.fn();
    vi.stubGlobal("turnstile",{render:vi.fn((_element,settings)=>{options=settings;return "widget";}),reset,remove:vi.fn()});
    const action=vi.fn<(data:FormData)=>Promise<{code:string;message:string}>>().mockResolvedValue({code:"AUTH_CHALLENGE_FAILED",message:"Try verification again."});
    render(<AuthInitiationForm provider="google" siteKey="fixture-site" returnTo="/sources" action={action}/>);
    const button=screen.getByRole("button",{name:"Continue with Google"});
    expect(button).toBeDisabled();
    await waitFor(()=>expect(options.action).toBe("auth_google"));
    expect(options.appearance).toBe("interaction-only");
    act(()=>(options.callback as (token:string)=>void)("fixture-token"));
    expect(button).toBeEnabled();
    fireEvent.submit(button.closest("form")!);
    await screen.findByRole("alert");
    expect(action).toHaveBeenCalledTimes(1);
    const data=action.mock.calls[0][0] as unknown as FormData;
    expect(data.get("cf-turnstile-response")).toBe("fixture-token");expect(data.get("returnTo")).toBe("/sources");
    expect(reset).toHaveBeenCalledWith("widget");expect(button).toBeDisabled();
  });
  it("refreshes expired tokens and uses the exact Microsoft action",async()=>{
    let options:Record<string,unknown>={};const reset=vi.fn();
    vi.stubGlobal("turnstile",{render:vi.fn((_element,settings)=>{options=settings;return "widget";}),reset,remove:vi.fn()});
    render(<AuthInitiationForm provider="microsoft-entra-id" siteKey="fixture-site" returnTo="/" action={vi.fn()}/>);
    await waitFor(()=>expect(options.action).toBe("auth_microsoft"));
    act(()=>(options.callback as (token:string)=>void)("fixture-token"));
    act(()=>(options["expired-callback"] as ()=>void)());
    expect(reset).toHaveBeenCalledWith("widget");expect(screen.getByRole("button")).toBeDisabled();
  });
});

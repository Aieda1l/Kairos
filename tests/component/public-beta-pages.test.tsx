// @vitest-environment jsdom
import type {ComponentType} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {cleanup,render,screen,within} from "@testing-library/react";
import {afterEach,expect,it} from "vitest";
import HomePage from "@/app/page";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";

// Discover new routes without turning a missing page into an import error in RED.
const newPages=import.meta.glob<{default:ComponentType}>("../../src/app/{support,security}/page.tsx");
async function publicPage(name:"support"|"security"){
  const load=newPages[`../../src/app/${name}/page.tsx`];
  expect(load,`/${name} must have an anonymous public page`).toBeDefined();
  return (await load()).default;
}
afterEach(cleanup);

it("public_pages_explain_UW_first_open_identity_optional_calendar",()=>{
  render(<HomePage/>);
  expect(screen.getByRole("heading",{name:"Kairos"})).toBeInTheDocument();
  expect(screen.getByText(/assignment dashboard/i)).toHaveTextContent(/Canvas.*Gradescope.*Ed/i);
  expect(screen.getByText(/UW-first/i)).toHaveTextContent(/Google.*Microsoft/i);
  expect(screen.getByText(/calendar connections are optional/i)).toHaveTextContent(/separate.*sign-in/i);
  expect(screen.getByRole("link",{name:/sign in/i})).toHaveAttribute("href","/sign-in?returnTo=/upcoming");
  const navigation=screen.getByRole("navigation",{name:"Legal and contact"});
  for(const [label,path] of [["Privacy","/privacy"],["Terms","/terms"],["Support","/support"],["Security","/security"]]){
    expect(within(navigation).getByRole("link",{name:label})).toHaveAttribute("href",path);
  }
});

it("policy_describes_identity_data_without_identity_tokens",()=>{
  const {container}=render(<PrivacyPage/>);
  const text=container.textContent!;
  expect(text).toMatch(/name, email.*profile image.*provider.*account.*session/i);
  expect(text).toMatch(/does not persist.*identity.*access.*refresh.*ID tokens/i);
  expect(text).toMatch(/calendar\.app\.created/);
  expect(text).toMatch(/Calendars\.ReadWrite/);
  expect(text).toMatch(/encrypted.*refresh tokens/i);
  expect(text).toMatch(/course.*assignment.*grade/i);
  expect(screen.getByRole("link",{name:/Google API Services User Data Policy/i})).toHaveAttribute("href","https://developers.google.com/terms/api-services-user-data-policy");
  expect(text).not.toMatch(/notice describes the hosted foundation during development/i);
});

it("policy_explains_extension_data_and_deletion_limits",()=>{
  const {container}=render(<PrivacyPage/>);
  const text=container.textContent!;
  expect(text).toMatch(/websiteContent.*browsingActivity/);
  expect(text).toMatch(/prepared.*0\.4\.0/i);
  expect(text).toMatch(/earlier development builds.*installed.*version.*compatibility/i);
  expect(text).toMatch(/not-shared/);
  expect(text).toMatch(/local.*popup.*installed version/i);
  expect(text).toMatch(/diagnostic.*HTTP.*DOM/i);
  expect(text).toMatch(/does not.*automatically.*remote.*events.*revoke.*consent/i);
  expect(text).toMatch(/Time Travel.*7 days.*30 days/i);
  expect(text).toMatch(/persistent.*logs.*disabled/i);
  expect(text).toMatch(/Turnstile.*not.*active.*production/i);
  expect(screen.getByRole("link",{name:/Google account connections/i})).toHaveAttribute("href","https://myaccount.google.com/connections");
});

it("security_page_discourages_credentials_in_public_issues",async()=>{
  const SecurityPage=await publicPage("security");
  const {container}=render(<SecurityPage/>);
  expect(screen.getByRole("heading",{name:"Security"})).toBeInTheDocument();
  expect(screen.getByRole("link",{name:"security@mykairos.me"})).toHaveAttribute("href","mailto:security@mykairos.me");
  expect(container.textContent).toMatch(/do not post.*credentials.*public issues/i);
  expect(container.textContent).toMatch(/feed URLs.*tokens.*cookies/i);
  expect(container.textContent).toMatch(/delivery.*pending/i);
});

it("contact_links_never_publish_personal_destination",async()=>{
  const SupportPage=await publicPage("support");
  const SecurityPage=await publicPage("security");
  for(const Page of [HomePage,PrivacyPage,TermsPage,SupportPage,SecurityPage]){
    const {container,unmount}=render(<Page/>);
    const mailLinks=Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:"]'));
    for(const link of mailLinks){
      expect(["mailto:support@mykairos.me","mailto:security@mykairos.me"]).toContain(link.getAttribute("href"));
    }
    const publishedEmails=container.textContent!.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)??[];
    for(const email of publishedEmails)expect(["support@mykairos.me","security@mykairos.me"]).toContain(email);
    unmount();
  }
  render(<SupportPage/>);
  expect(screen.getByRole("link",{name:"support@mykairos.me"})).toHaveAttribute("href","mailto:support@mykairos.me");
  expect(screen.getByText(/routing.*active/i)).toHaveTextContent(/delivery.*pending/i);
});

it("public_routes_render_information_without_session_or_client_javascript",async()=>{
  const SupportPage=await publicPage("support");
  const SecurityPage=await publicPage("security");
  for(const [Page,title] of [[HomePage,"Kairos"],[PrivacyPage,"Privacy"],[TermsPage,"Terms"],[SupportPage,"Support"],[SecurityPage,"Security"]] as const){
    const html=renderToStaticMarkup(<Page/>);
    const document=new DOMParser().parseFromString(html,"text/html");
    expect(document.querySelector("main h1")?.textContent).toBe(title);
    expect(document.querySelector("main")?.textContent!.length).toBeGreaterThan(300);
    expect(document.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(document.querySelector('a[href="/support"]')).not.toBeNull();
    expect(document.querySelector("form")).toBeNull();
  }
});

// @vitest-environment jsdom
import {render,screen} from "@testing-library/react";
import {expect,it,vi} from "vitest";
vi.mock("@/lib/guest/server/feature",()=>({getGuestEnabled:async()=>false}));
import HomePage from "@/app/page";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import SupportPage from "@/app/support/page";

it("distinguishes guest local storage, transient processing, private backups and hosted persistence",()=>{
  const {rerender}=render(<PrivacyPage/>);
  expect(screen.getByRole("region",{name:"Guest mode, when available"})).toBeVisible();
  expect(screen.getByText(/plaintext.*browser profile/i)).toBeVisible();
  expect(screen.getByText(/transient.*Canvas.*Ed/i)).toBeVisible();
  expect(screen.getByText(/anonymous.*HMAC/i)).toBeVisible();
  expect(screen.getByText(/AES-GCM/)).toBeVisible();
  rerender(<TermsPage/>);expect(screen.getByText(/no server restore/i)).toBeVisible();
  rerender(<SupportPage/>);expect(screen.getByText(/backups.*private coursework.*grades/i)).toBeVisible();
});

it("renders the public homepage without requiring a session",async()=>{
  render(await HomePage());
  expect(screen.getByRole("heading",{name:"Kairos"})).toBeInTheDocument();
  expect(screen.getByText(/not affiliated with or endorsed by the University of Washington/i)).toBeInTheDocument();
  expect(screen.getAllByRole("link",{name:/sign in|open kairos/i})).toHaveLength(2);
});

it("renders privacy and terms pages while signed out",()=>{
  const {rerender}=render(<PrivacyPage/>);
  expect(screen.getByRole("heading",{name:"Privacy"})).toBeInTheDocument();
  rerender(<TermsPage/>);
  expect(screen.getByRole("heading",{name:"Terms"})).toBeInTheDocument();
});

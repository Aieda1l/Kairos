// @vitest-environment jsdom
import {render,screen} from "@testing-library/react";
import {expect,it} from "vitest";
import HomePage from "@/app/page";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";

it("renders the public homepage without requiring a session",()=>{
  render(<HomePage/>);
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

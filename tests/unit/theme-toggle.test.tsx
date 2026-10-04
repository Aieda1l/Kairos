import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/theme-toggle";

const { useTheme } = vi.hoisted(() => ({ useTheme: vi.fn() }));
vi.mock("next-themes", () => ({ useTheme }));

beforeEach(() => { useTheme.mockReset(); });

it("renders identical markup before and after theme resolution", () => {
  useTheme.mockReturnValue({ resolvedTheme: undefined, setTheme: vi.fn() });
  const unresolved = renderToStaticMarkup(<ThemeToggle />);
  useTheme.mockReturnValue({ resolvedTheme: "dark", setTheme: vi.fn() });
  const dark = renderToStaticMarkup(<ThemeToggle />);
  expect(dark).toBe(unresolved);
  expect(dark).toContain('aria-label="Toggle theme"');
});

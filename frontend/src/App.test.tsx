import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";

// Stub fetch to keep the screens' useEffect calls quiet.
beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ items: [], presets: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
});

describe("App", () => {
  it("renders the product name", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "OpenRAG-Lab" })).toBeInTheDocument();
  });

  it("shows the Auto-Pilot heading on the index route", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Auto-Pilot" })).toBeInTheDocument();
  });

  it("renders the chunking lab on /chunking", () => {
    render(
      <MemoryRouter initialEntries={["/chunking"]}>
        <App />
      </MemoryRouter>,
    );
    // Without an active workspace the screen prompts the user to pick one.
    expect(screen.getByText(/워크스페이스를 먼저 선택/)).toBeInTheDocument();
  });
});

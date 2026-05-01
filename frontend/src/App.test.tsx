import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [], presets: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

describe("App", () => {
  it("renders the wordmark in the header", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    // Wordmark is split into "OpenRAG", "·", "Lab" but the heading concats text.
    expect(screen.getByRole("heading", { level: 1, name: /OpenRAG.*Lab/ })).toBeInTheDocument();
  });

  it("shows the Auto-Pilot title on the index route", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Drag your folder/)).toBeInTheDocument();
  });

  it("prompts for a workspace on /chunking when none is selected", () => {
    render(
      <MemoryRouter initialEntries={["/chunking"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText(/워크스페이스를 먼저 선택/)).toBeInTheDocument();
  });

  it("renders the four nav buttons in the shell", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    for (const label of ["Auto-Pilot", "Chunking Lab", "Chat", "Experiments"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });
});

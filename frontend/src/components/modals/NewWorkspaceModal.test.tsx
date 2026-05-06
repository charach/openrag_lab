import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PresetResponse } from "../../api/client";
import { NewWorkspaceModal } from "./NewWorkspaceModal";

type Preset = PresetResponse["presets"][number];

const PRESETS: Preset[] = [
  {
    id: "speed",
    name: "Speed",
    available: true,
    config: {
      embedder_id: "bge-small-en",
      chunking: { strategy: "fixed", chunk_size: 512, chunk_overlap: 64 },
      retrieval_strategy: "vector",
      top_k: 5,
      llm_id: null,
    },
  },
  {
    id: "balanced",
    name: "Balanced",
    available: true,
    recommended: true,
    config: {
      embedder_id: "bge-base-en",
      chunking: { strategy: "fixed", chunk_size: 512, chunk_overlap: 64 },
      retrieval_strategy: "vector",
      top_k: 5,
      llm_id: null,
    },
  },
  {
    id: "accuracy",
    name: "Accuracy",
    available: false,
    config: {
      embedder_id: "bge-large-en",
      chunking: { strategy: "fixed", chunk_size: 512, chunk_overlap: 64 },
      retrieval_strategy: "vector",
      top_k: 5,
      llm_id: null,
    },
  },
];

describe("NewWorkspaceModal", () => {
  it("disables Create until a name is entered", () => {
    render(
      <NewWorkspaceModal
        onCreate={vi.fn()}
        onClose={vi.fn()}
        presetsOverride={PRESETS}
      />,
    );
    const create = screen.getByRole("button", { name: "Create workspace" });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByTestId("new-workspace-name"), {
      target: { value: "my ws" },
    });
    expect(create).not.toBeDisabled();
  });

  it("preselects the recommended available preset", () => {
    render(
      <NewWorkspaceModal
        onCreate={vi.fn()}
        onClose={vi.fn()}
        presetsOverride={PRESETS}
      />,
    );
    expect(screen.getByTestId("preset-balanced")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("does not allow selecting unavailable presets", () => {
    render(
      <NewWorkspaceModal
        onCreate={vi.fn()}
        onClose={vi.fn()}
        presetsOverride={PRESETS}
      />,
    );
    const accuracy = screen.getByTestId("preset-accuracy");
    expect(accuracy).toBeDisabled();
    fireEvent.click(accuracy);
    expect(accuracy).toHaveAttribute("aria-checked", "false");
  });

  it("calls onCreate with the trimmed name and selected preset", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <NewWorkspaceModal
        onCreate={onCreate}
        onClose={vi.fn()}
        presetsOverride={PRESETS}
      />,
    );
    fireEvent.change(screen.getByTestId("new-workspace-name"), {
      target: { value: "  hello  " },
    });
    fireEvent.click(screen.getByTestId("preset-speed"));
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("hello", "speed"));
  });

  it("shows the error message when onCreate rejects", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("name taken"));
    render(
      <NewWorkspaceModal
        onCreate={onCreate}
        onClose={vi.fn()}
        presetsOverride={PRESETS}
      />,
    );
    fireEvent.change(screen.getByTestId("new-workspace-name"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(screen.getByText("name taken")).toBeInTheDocument());
  });
});

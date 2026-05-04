import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FormatTag, Modal, RetrievalOnlyBadge, ScoreCell, Step } from "./ui";

describe("ui primitives", () => {
  it("FormatTag uppercases unknown formats", () => {
    render(<FormatTag format="csv" />);
    expect(screen.getByText("CSV")).toBeInTheDocument();
  });

  it("FormatTag uses the friendly label for known formats", () => {
    render(<FormatTag format="md" />);
    expect(screen.getByText("MD")).toBeInTheDocument();
  });

  it("RetrievalOnlyBadge renders the label", () => {
    render(<RetrievalOnlyBadge />);
    expect(screen.getByText("Retrieval-only")).toBeInTheDocument();
  });

  it("ScoreCell renders an em-dash for null scores", () => {
    render(<ScoreCell value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("ScoreCell formats a numeric score to two decimals", () => {
    render(<ScoreCell value={0.875} />);
    expect(screen.getByText("0.88")).toBeInTheDocument();
  });

  it("Modal fires onConfirm on Enter and onClose on Escape", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <Modal title="Delete" onClose={onClose} onConfirm={onConfirm}>
        <input aria-label="focus-me" />
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Modal does not fire onConfirm when Enter is pressed in a textarea", () => {
    const onConfirm = vi.fn();
    render(
      <Modal title="Compose" onClose={() => undefined} onConfirm={onConfirm}>
        <textarea aria-label="body" />
      </Modal>,
    );
    const ta = screen.getByLabelText("body");
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Step renders the step number, title, and the In-progress chip when active", () => {
    render(
      <Step number="02" title="Workspace" status="active">
        body
      </Step>,
    );
    expect(screen.getByText("STEP 02")).toBeInTheDocument();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});

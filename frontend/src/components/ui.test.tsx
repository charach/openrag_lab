import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormatTag, RetrievalOnlyBadge, ScoreCell, Step } from "./ui";

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

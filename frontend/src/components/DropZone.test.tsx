import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DropZone } from "./DropZone";

function makeFile(name: string, size = 10): File {
  return new File(["x".repeat(size)], name, { type: "text/plain" });
}

describe("DropZone", () => {
  it("renders the default caption", () => {
    render(<DropZone onFiles={() => {}} />);
    expect(screen.getByText("Drop files here, or click to browse")).toBeInTheDocument();
  });

  it("emits onFiles with dropped files", () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} data-testid="zone" />);
    const zone = screen.getByTestId("zone");
    const file = makeFile("a.pdf");
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it("emits onFiles when files are picked via the hidden input", () => {
    const onFiles = vi.fn();
    const { container } = render(<DropZone onFiles={onFiles} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile("b.txt");
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it("ignores drops while disabled and shows the disabled caption", () => {
    const onFiles = vi.fn();
    render(
      <DropZone
        onFiles={onFiles}
        disabled
        disabledCaption="Uploading…"
        data-testid="zone"
      />,
    );
    expect(screen.getByText("Uploading…")).toBeInTheDocument();
    fireEvent.drop(screen.getByTestId("zone"), {
      dataTransfer: { files: [makeFile("c.md")] },
    });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("renders the hint only in stack layout", () => {
    const { rerender } = render(
      <DropZone onFiles={() => {}} layout="stack" hint="PDF · TXT · MD" />,
    );
    expect(screen.getByText("PDF · TXT · MD")).toBeInTheDocument();
    rerender(<DropZone onFiles={() => {}} layout="row" hint="PDF · TXT · MD" />);
    expect(screen.queryByText("PDF · TXT · MD")).not.toBeInTheDocument();
  });

  it("does nothing on an empty drop", () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} data-testid="zone" />);
    fireEvent.drop(screen.getByTestId("zone"), {
      dataTransfer: { files: [] },
    });
    expect(onFiles).not.toHaveBeenCalled();
  });
});

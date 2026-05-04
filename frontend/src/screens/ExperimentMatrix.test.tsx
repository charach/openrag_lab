import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CatalogSelect, uniqueValues } from "./ExperimentMatrix";

describe("uniqueValues", () => {
  it("dedupes preserving first-seen order, drops empty strings", () => {
    expect(uniqueValues(["a", "b", "a", "", "c", "b"])).toEqual(["a", "b", "c"]);
  });
});

describe("CatalogSelect", () => {
  it("renders preset options and reports the chosen value", () => {
    const onChange = vi.fn();
    render(
      <CatalogSelect
        value="bge-small"
        options={["bge-small", "mpnet-base"]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "mpnet-base" } });
    expect(onChange).toHaveBeenCalledWith("mpnet-base");
  });

  it("reveals a free-form input when (custom) is picked", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CatalogSelect value="" options={["bge-small"]} onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__custom__" } });
    // Picking custom resets to empty; the consumer re-renders with new value.
    rerender(
      <CatalogSelect value="my-private-model" options={["bge-small"]} onChange={onChange} />,
    );
    expect(screen.getByDisplayValue("my-private-model")).toBeInTheDocument();
  });

  it("treats empty as a valid choice when allowEmpty is set", () => {
    const onChange = vi.fn();
    render(
      <CatalogSelect
        value=""
        options={["claude-haiku"]}
        onChange={onChange}
        allowEmpty
        emptyLabel="(retrieval-only)"
      />,
    );
    expect(screen.getByText("(retrieval-only)")).toBeInTheDocument();
  });
});

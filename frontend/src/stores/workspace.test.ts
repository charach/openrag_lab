import { afterEach, beforeEach, describe, expect, it } from "vitest";

const STORAGE_KEY = "openrag.activeWorkspaceId";

describe("workspace store persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("loads activeWorkspaceId from localStorage on import", async () => {
    window.localStorage.setItem(STORAGE_KEY, "ws_persisted");
    const { useWorkspaceStore } = await import("./workspace?fresh=loads");
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws_persisted");
  });

  it("persists setActiveWorkspace to localStorage", async () => {
    const { useWorkspaceStore } = await import("./workspace?fresh=writes");
    useWorkspaceStore.getState().setActiveWorkspace("ws_new");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("ws_new");
  });

  it("removes from localStorage when set to null", async () => {
    window.localStorage.setItem(STORAGE_KEY, "ws_x");
    const { useWorkspaceStore } = await import("./workspace?fresh=clears");
    useWorkspaceStore.getState().setActiveWorkspace(null);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

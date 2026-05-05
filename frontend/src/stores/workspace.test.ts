import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "openrag.activeWorkspaceId";

// Re-import the module after resetting Vitest's cache so the Zustand
// store picks up a fresh ``initial`` from localStorage every test.
async function loadFreshStore(): Promise<typeof import("./workspace")> {
  vi.resetModules();
  return await import("./workspace");
}

describe("workspace store persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("loads activeWorkspaceId from localStorage on import", async () => {
    window.localStorage.setItem(STORAGE_KEY, "ws_persisted");
    const { useWorkspaceStore } = await loadFreshStore();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws_persisted");
  });

  it("persists setActiveWorkspace to localStorage", async () => {
    const { useWorkspaceStore } = await loadFreshStore();
    useWorkspaceStore.getState().setActiveWorkspace("ws_new");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("ws_new");
  });

  it("removes from localStorage when set to null", async () => {
    window.localStorage.setItem(STORAGE_KEY, "ws_x");
    const { useWorkspaceStore } = await loadFreshStore();
    useWorkspaceStore.getState().setActiveWorkspace(null);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

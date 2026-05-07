import { beforeEach, describe, expect, it } from "vitest";
import { useBatchSessionStore } from "./batchSession";

const init = {
  batchId: "batch_1",
  taskId: "task_1",
  websocketTopic: "experiments.batch.batch_1",
  workspaceId: "ws_1",
  total: 2,
};

describe("batchSession store", () => {
  beforeEach(() => {
    useBatchSessionStore.getState().dismiss();
  });

  it("start moves into running with empty progress", () => {
    useBatchSessionStore.getState().start(init);
    const s = useBatchSessionStore.getState();
    expect(s.phase).toBe("running");
    expect(s.active?.batchId).toBe("batch_1");
    expect(s.active?.done).toBe(0);
    expect(s.active?.total).toBe(2);
  });

  it("started message captures combo list", () => {
    const store = useBatchSessionStore.getState();
    store.start(init);
    store.applyMessage({
      type: "started",
      total: 2,
      combos: [
        {
          embedder_id: "fake",
          chunking: { strategy: "recursive", chunk_size: 64, chunk_overlap: 0 },
          retrieval_strategy: "dense",
        },
        {
          embedder_id: "fake",
          chunking: { strategy: "recursive", chunk_size: 96, chunk_overlap: 0 },
          retrieval_strategy: "dense",
        },
      ],
    });
    expect(useBatchSessionStore.getState().active?.combos).toHaveLength(2);
  });

  it("progress messages advance done + record results", () => {
    const store = useBatchSessionStore.getState();
    store.start(init);
    store.applyMessage({
      type: "progress",
      done: 1,
      total: 2,
      current_combo: {
        index: 0,
        embedder_id: "fake",
        chunking: { strategy: "recursive", chunk_size: 64, chunk_overlap: 0 },
        retrieval_strategy: "dense",
        experiment_id: "exp_a",
        scores: { faithfulness: 0.5 },
      },
    });
    const a = useBatchSessionStore.getState().active!;
    expect(a.done).toBe(1);
    expect(a.results).toHaveLength(1);
    expect(a.results[0].experiment_id).toBe("exp_a");
    expect(a.current?.experiment_id).toBe("exp_a");
  });

  it("completed message flips phase to done", () => {
    const store = useBatchSessionStore.getState();
    store.start(init);
    store.applyMessage({
      type: "completed",
      results: [{ experiment_id: "exp_a", scores: { faithfulness: 0.5 } }],
      cancelled: false,
    });
    expect(useBatchSessionStore.getState().phase).toBe("done");
  });

  it("completed with cancelled=true flips phase to cancelled", () => {
    const store = useBatchSessionStore.getState();
    store.start(init);
    store.applyMessage({ type: "completed", results: [], cancelled: true });
    expect(useBatchSessionStore.getState().phase).toBe("cancelled");
  });

  it("dismiss resets to idle", () => {
    const store = useBatchSessionStore.getState();
    store.start(init);
    store.dismiss();
    const s = useBatchSessionStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.active).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { useIndexingStore } from "./indexing";
import type { IndexAcceptedResponse } from "../api/client";

const fakeTask: IndexAcceptedResponse = {
  task_id: "task_1",
  experiment_id: "exp_1",
  config_fingerprint: "fp_1",
  estimated_duration_seconds: 10,
  websocket_topic: "indexing.task_1",
  external_calls: [],
};

describe("indexing store", () => {
  beforeEach(() => {
    useIndexingStore.getState().reset();
  });

  it("startStarting puts the store into 'starting'", () => {
    useIndexingStore.getState().startStarting("ws_a");
    const s = useIndexingStore.getState();
    expect(s.phase).toBe("starting");
    expect(s.workspaceId).toBe("ws_a");
    expect(s.task).toBeNull();
  });

  it("setTask transitions starting → running", () => {
    useIndexingStore.getState().startStarting("ws_a");
    useIndexingStore.getState().setTask(fakeTask);
    expect(useIndexingStore.getState().phase).toBe("running");
    expect(useIndexingStore.getState().task).toEqual(fakeTask);
  });

  it("setProgress with ratio>=0.999 marks phase done", () => {
    useIndexingStore.getState().startStarting("ws_a");
    useIndexingStore.getState().setTask(fakeTask);
    useIndexingStore.getState().setProgress({ topic: "indexing.task_1", type: "chunking", ratio: 0.999 });
    expect(useIndexingStore.getState().phase).toBe("done");
  });

  it("setProgress before task arrival promotes starting → running", () => {
    useIndexingStore.getState().startStarting("ws_a");
    useIndexingStore.getState().setProgress({ topic: "indexing.task_1", type: "parsing", ratio: 0.05 });
    expect(useIndexingStore.getState().phase).toBe("running");
  });

  it("setFileProgress upserts a file row indexed by file_id", () => {
    const store = useIndexingStore.getState();
    store.setFileProgress({
      topic: "indexing.task_1",
      type: "file_progress",
      file_id: "doc_a",
      file_name: "alpha.txt",
      file_stage: "parsing",
      ratio: 0,
    });
    expect(useIndexingStore.getState().files["doc_a"]).toMatchObject({
      fileId: "doc_a",
      fileName: "alpha.txt",
      stage: "parsing",
      ratio: 0,
      chunks: null,
    });
    store.setFileProgress({
      topic: "indexing.task_1",
      type: "file_progress",
      file_id: "doc_a",
      file_name: "alpha.txt",
      file_stage: "embedded",
      ratio: 1,
      chunks: 7,
    });
    const row = useIndexingStore.getState().files["doc_a"];
    expect(row.stage).toBe("embedded");
    expect(row.chunks).toBe(7);
    expect(row.ratio).toBe(1);
  });

  it("setFileProgress ignores malformed messages (missing required fields or bad stage)", () => {
    const store = useIndexingStore.getState();
    store.setFileProgress({
      topic: "indexing.task_1",
      type: "file_progress",
      file_name: "x.txt",
      file_stage: "parsing",
      ratio: 0,
    });
    expect(Object.keys(useIndexingStore.getState().files)).toHaveLength(0);

    store.setFileProgress({
      topic: "indexing.task_1",
      type: "file_progress",
      file_id: "doc_b",
      file_name: "b.txt",
      file_stage: "bogus",
      ratio: 0,
    });
    expect(Object.keys(useIndexingStore.getState().files)).toHaveLength(0);
  });

  it("reset clears the per-file map", () => {
    const store = useIndexingStore.getState();
    store.setFileProgress({
      topic: "indexing.task_1",
      type: "file_progress",
      file_id: "doc_c",
      file_name: "c.txt",
      file_stage: "embedded",
      ratio: 1,
      chunks: 3,
    });
    store.reset();
    expect(useIndexingStore.getState().files).toEqual({});
  });

  it("markCancelled / markError transitions terminal phases", () => {
    useIndexingStore.getState().startStarting("ws_a");
    useIndexingStore.getState().markCancelled();
    expect(useIndexingStore.getState().phase).toBe("cancelled");
    useIndexingStore.getState().reset();
    useIndexingStore.getState().startStarting("ws_a");
    useIndexingStore.getState().markError("boom");
    expect(useIndexingStore.getState().phase).toBe("error");
    expect(useIndexingStore.getState().error).toBe("boom");
  });
});

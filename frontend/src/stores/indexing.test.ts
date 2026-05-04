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
    useIndexingStore.getState().setProgress({ topic: "indexing.task_1", type: "subscribed" });
    expect(useIndexingStore.getState().phase).toBe("running");
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

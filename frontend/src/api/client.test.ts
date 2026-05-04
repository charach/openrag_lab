import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiException } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetchOnce(response: Response): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("api.importGoldenPairs", () => {
  it("posts FormData to /pairs/import and returns the body", async () => {
    const fn = stubFetchOnce(
      new Response(JSON.stringify({ added: 3, skipped: 1, errors: [] }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const file = new File(["q,a\n1,2\n"], "pairs.csv", { type: "text/csv" });

    const result = await api.importGoldenPairs("ws-1", "gs-7", file);

    expect(result).toEqual({ added: 3, skipped: 1, errors: [] });
    expect(fn).toHaveBeenCalledOnce();
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/workspaces/ws-1/golden-sets/gs-7/pairs/import");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const body = init.body as FormData;
    expect((body.get("file") as File).name).toBe("pairs.csv");
  });

  it("throws ApiException with backend error payload on 422", async () => {
    stubFetchOnce(
      new Response(
        JSON.stringify({
          error: { code: "BAD_REQUEST_FIELD", message: "bad csv", recoverable: false },
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );
    const file = new File(["x"], "bad.csv");

    await expect(api.importGoldenPairs("ws", "gs", file)).rejects.toMatchObject({
      status: 422,
      error: { code: "BAD_REQUEST_FIELD" },
    });
  });
});

describe("api.evaluateExperiment", () => {
  it("posts JSON body and returns the task envelope", async () => {
    const envelope = {
      task_id: "task-abc",
      websocket_topic: "evaluation:exp-1",
      estimated_duration_seconds: 15,
      external_calls: [],
    };
    const fn = stubFetchOnce(
      new Response(JSON.stringify(envelope), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await api.evaluateExperiment("ws-1", "exp-1", {
      golden_set_id: "gs-9",
    });

    expect(result).toEqual(envelope);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/workspaces/ws-1/experiments/exp-1/evaluate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ golden_set_id: "gs-9" });
    expect((init.headers as Headers).get("content-type")).toBe("application/json");
  });

  it("propagates 404 as ApiException", async () => {
    stubFetchOnce(
      new Response(
        JSON.stringify({
          error: { code: "EXPERIMENT_NOT_FOUND", message: "no", recoverable: false },
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      api.evaluateExperiment("ws", "exp", { golden_set_id: "gs" }),
    ).rejects.toBeInstanceOf(ApiException);
  });
});

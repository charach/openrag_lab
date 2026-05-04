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

describe("api.listExternalProviders", () => {
  it("GETs /system/external-providers and returns the providers array", async () => {
    const fn = stubFetchOnce(
      new Response(
        JSON.stringify({
          providers: [
            { id: "openai", name: "OpenAI", key_registered: true, key_suffix: "...1234", supported_models: ["gpt-4o"] },
            { id: "anthropic", name: "Anthropic", key_registered: false, supported_models: [] },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const r = await api.listExternalProviders();

    expect(r.providers).toHaveLength(2);
    expect(r.providers[0]).toMatchObject({ id: "openai", key_registered: true, key_suffix: "...1234" });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/system/external-providers");
    expect(init.method).toBeUndefined();
  });
});

describe("api.registerExternalProviderKey", () => {
  it("POSTs JSON {key, validate_now} to /providers/{id}/key", async () => {
    const fn = stubFetchOnce(
      new Response(
        JSON.stringify({
          provider_id: "openai",
          key_registered: true,
          key_suffix: "...9999",
          registered_at: "2026-05-04T11:00:00Z",
          validation_status: "ok",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const r = await api.registerExternalProviderKey("openai", {
      key: "sk-xxx-9999",
      validate_now: true,
    });

    expect(r.provider_id).toBe("openai");
    expect(r.validation_status).toBe("ok");
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/system/external-providers/openai/key");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ key: "sk-xxx-9999", validate_now: true });
  });

  it("propagates 422 EXTERNAL_API_KEY_INVALID as ApiException", async () => {
    stubFetchOnce(
      new Response(
        JSON.stringify({
          error: { code: "EXTERNAL_API_KEY_INVALID", message: "no", recoverable: true },
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      api.registerExternalProviderKey("openai", { key: "bad" }),
    ).rejects.toMatchObject({ status: 422, error: { code: "EXTERNAL_API_KEY_INVALID" } });
  });
});

describe("api.deleteExternalProviderKey", () => {
  it("DELETEs and returns nothing on 204", async () => {
    const fn = stubFetchOnce(new Response(null, { status: 204 }));

    const r = await api.deleteExternalProviderKey("anthropic");

    expect(r).toBeUndefined();
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/system/external-providers/anthropic/key");
    expect(init.method).toBe("DELETE");
  });

  it("propagates 409 PROVIDER_IN_USE with workspace_ids", async () => {
    stubFetchOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "PROVIDER_IN_USE",
            message: "in use",
            recoverable: false,
            details: { provider_id: "openai", workspace_ids: ["ws_a", "ws_b"] },
          },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );

    try {
      await api.deleteExternalProviderKey("openai");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiException);
      const apiErr = (e as ApiException).error;
      expect(apiErr.code).toBe("PROVIDER_IN_USE");
      expect(apiErr.details?.workspace_ids).toEqual(["ws_a", "ws_b"]);
    }
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

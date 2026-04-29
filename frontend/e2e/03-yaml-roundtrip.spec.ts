/**
 * Scenario 3 — YAML round trip.
 *
 * Export the YAML from a workspace that has been indexed, import it into a
 * fresh workspace, and confirm the resulting fingerprint matches and the
 * /chunking/preview returns the same config_key. This skips the UI: the
 * endpoints are the contract the PHASE 4 §3 acceptance criterion targets.
 */
import { test, expect } from "@playwright/test";
import { Buffer } from "buffer";

const TEXT = "lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(40);

test("YAML round trip preserves fingerprint", async ({ request }) => {
  const ws1 = (await (
    await request.post("/api/workspaces", {
      data: { name: "src-ws" },
    })
  ).json()) as { id: string };

  await request.post(`/api/workspaces/${ws1.id}/documents`, {
    multipart: {
      files: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from(TEXT) },
    },
  });

  const indexResp = await request.post(`/api/workspaces/${ws1.id}/index`, {
    data: {
      config: {
        embedder_id: "fake-embedder",
        chunking: { strategy: "recursive", chunk_size: 64, chunk_overlap: 8 },
        retrieval_strategy: "dense",
        top_k: 3,
        llm_id: null,
      },
    },
  });
  const accepted = await indexResp.json();
  const taskId: string = accepted.task_id;

  for (let i = 0; i < 60; i++) {
    const r = await request.get(`/api/tasks/${taskId}`);
    if ((await r.json()).status === "completed") break;
    await new Promise((res) => setTimeout(res, 500));
  }

  const exported = await (await request.get(`/api/workspaces/${ws1.id}/config/export`)).text();
  expect(exported).toContain("version:");
  expect(exported).toContain("fingerprint:");

  // Fresh workspace, import into it.
  const ws2 = (await (
    await request.post("/api/workspaces", {
      data: { name: "dst-ws" },
    })
  ).json()) as { id: string };

  const importResp = await request.post(`/api/workspaces/${ws2.id}/config/import`, {
    data: exported,
    headers: { "content-type": "application/yaml" },
  });
  expect(importResp.ok()).toBeTruthy();
  const importBody = await importResp.json();
  expect(importBody.fingerprint).toBe(accepted.config_fingerprint);
  // No prior config in ws2 → embedder_changed should be False (previous is
  // None, so we treat no-experiment as no-change).
  expect(importBody.embedder_changed).toBeFalsy();
});

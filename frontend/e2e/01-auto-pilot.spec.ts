/**
 * Scenario 1 — Auto-Pilot happy path.
 *
 * TODO.md Phase 4 §3.1: PDF/text upload → indexing → chat. We use a small
 * .txt file so the run finishes within the 60s test timeout even on slow
 * CI runners (and so that the e2e factory's FakeEmbedder is enough).
 */
import { test, expect } from "@playwright/test";

test("Auto-Pilot: upload, index, chat", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Auto-Pilot" })).toBeVisible();

  // Pick the recommended preset (whichever it is for the host).
  const recommended = page.locator('input[type="radio"][name="preset"]:checked');
  await expect(recommended).toBeVisible();

  // Provide a deterministic name + a small text file.
  await page.getByLabel("이름:").fill("e2e-auto-pilot");
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("the quick brown fox jumps over the lazy dog. ".repeat(40)),
  });

  await page.getByRole("button", { name: "시작" }).click();

  // Wait for the indexing card to surface.
  await expect(page.getByText(/task_id:/)).toBeVisible({ timeout: 30_000 });

  // Once we see the chat link, indexing has been accepted; navigate.
  await page.getByRole("link", { name: /채팅으로/ }).click();

  await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();
  // Wait for the experiment dropdown to populate (the indexing job needs
  // to flush its result row before the GET /experiments call sees it).
  await expect(page.locator("select option").nth(1)).toBeAttached({
    timeout: 30_000,
  });
  await page.getByRole("textbox").fill("what jumps?");
  await page.getByRole("button", { name: "질문" }).click();

  // In retrieval-only mode (default Auto-Pilot preset has llm_id=null) the
  // response shows the badge + chunks list.
  await expect(page.getByText(/검색 전용 모드/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/참조한 청크/)).toBeVisible();
});

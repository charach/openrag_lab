/**
 * Scenario 1 — Auto-Pilot happy path.
 *
 * Phase 4 §3.1: PDF/text upload → indexing → chat. We use a small .txt file
 * so the run finishes within the test timeout even on slow CI runners (and
 * so the e2e factory's FakeEmbedder is enough).
 *
 * Selectors prefer ``data-testid`` over copy because Phase 5 reshuffled
 * UI strings; testids let the spec survive future copy edits.
 */
import { test, expect } from "@playwright/test";

test.setTimeout(120_000);

test("Auto-Pilot: upload, index, chat", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Drag your folder")).toBeVisible();

  // The recommended preset auto-selects on mount; assert at least one
  // preset card is present + pressed.
  const pressedPreset = page.locator(
    '[data-testid^="wizard-preset-"][aria-pressed="true"]',
  );
  await expect(pressedPreset).toHaveCount(1);

  // Force a fresh workspace name for determinism — bypasses any stale
  // active-workspace selection from previous runs.
  await page.getByTestId("wizard-mode-new").click();
  await page.getByTestId("wizard-workspace-name").fill("e2e-auto-pilot");

  // The drop-zone wraps a hidden <input type="file"> inside a <label>.
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("the quick brown fox jumps over the lazy dog. ".repeat(40)),
  });

  await page.getByTestId("wizard-start").click();

  // First indexing run for a fresh ``OPENRAG_HOME`` triggers the license
  // gate (the recommended preset's embedder is in the model catalog and
  // hasn't been accepted yet). Tick the checkbox + confirm to proceed.
  const licenseCheckbox = page.getByTestId("license-accept-checkbox");
  try {
    await licenseCheckbox.waitFor({ state: "visible", timeout: 5_000 });
    await licenseCheckbox.check();
    await page.getByTestId("license-accept-confirm").click();
  } catch {
    // No license gate — model already accepted on this OPENRAG_HOME, or
    // a future build moved the gate elsewhere. Either is fine.
  }

  // Indexing card surfaces as soon as the task is accepted.
  await expect(page.getByText(/task_id/)).toBeVisible({ timeout: 30_000 });

  // Hub replays the last published message on subscribe, so the wizard
  // sees the final progress(ratio=1.0) even when indexing finishes before
  // the WS subscribe ack lands. "Go to Chat" enables on completion.
  const goChat = page.getByTestId("wizard-go-chat");
  await expect(goChat).toBeEnabled({ timeout: 60_000 });
  await goChat.click();
  await expect(page.getByText("Ask the corpus.")).toBeVisible();

  // The experiment rail populates after the chat screen reads /experiments.
  const experimentRow = page.getByTestId("chat-experiment-row").first();
  await expect(experimentRow).toBeVisible({ timeout: 30_000 });
  await experimentRow.click();

  await page.getByTestId("chat-composer").fill("what jumps?");
  await page.getByTestId("chat-ask").click();

  // Default Auto-Pilot preset has llm_id=null → response shows the
  // Retrieval-only badge plus the retrieved-chunks rail.
  await expect(page.getByText("Retrieval-only").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Retrieved chunks").first()).toBeVisible();
});

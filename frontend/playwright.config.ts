/**
 * Playwright configuration — boots the FastAPI backend in test mode and
 * the Vite dev server, then runs the three TODO.md Phase 4 scenarios.
 *
 * The backend writes to a temporary OPENRAG_HOME so test runs don't pollute
 * the developer's user-data dir, and ``OPENRAG_LAB_TEST_MODE=1`` swaps in
 * the deterministic FakeEmbedder + InMemoryVectorStore so tests don't need
 * sentence-transformers / Chroma installed.
 */
import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import { join } from "path";

const HOME = mkdtempSync(join(tmpdir(), "openrag-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // FastAPI backend in test mode.
      command:
        "cd .. && uv run uvicorn openrag_lab.app.main:create_app --factory --host 127.0.0.1 --port 8000",
      url: "http://127.0.0.1:8000/system/profile",
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: {
        OPENRAG_LAB_TEST_MODE: "1",
        OPENRAG_HOME: HOME,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
      },
    },
    {
      command: "pnpm dev --port 5173 --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});

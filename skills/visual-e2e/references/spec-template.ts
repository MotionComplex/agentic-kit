import fs from "node:fs";
import path from "node:path";
import { test } from "../../support/fixtures/visual";

const criteria = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(new URL(import.meta.url).pathname), "criteria/your-feature.json"),
    "utf8",
  ),
) as {
  qualityGoals: string[];
  steps: Array<{ id: string; criteria: string[] }>;
};

const stepCriteria = (id: string) =>
  criteria.steps.find((s) => s.id === id)?.criteria ?? criteria.qualityGoals;

test.describe("Your Feature visual review", () => {
  test("captures primary UI states", async ({ page, visitSkyView, captureVisual }) => {
    await visitSkyView({ date: "2025-07-15" });

    // Navigate to the scenario — use roles/labels from a11y e2e where possible
    await captureVisual({
      page,
      id: "primary-state",
      scenario: "Describe what the user sees",
      criteria: stepCriteria("primary-state"),
    });

    // Optional: toggle or navigate, then second capture
    await captureVisual({
      page,
      id: "alternate-state",
      scenario: "Comparison state",
      criteria: stepCriteria("alternate-state"),
    });
  });

  test("captures detail or modal (viewport)", async ({ page, visitSkyView, captureVisual }) => {
    await visitSkyView({ date: "2025-07-15" /* , object: "...", source: "search" */ });
    await page.waitForTimeout(1_500);

    await captureVisual({
      page,
      id: "detail-drawer",
      scenario: "Detail panel or modal",
      criteria: stepCriteria("detail-drawer"),
      target: "viewport",
    });
  });
});

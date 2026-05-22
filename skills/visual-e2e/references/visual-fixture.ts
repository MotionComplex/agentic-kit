import fs from "node:fs";
import path from "node:path";
import { test as base, expect } from "@playwright/test";

export const VISUAL_OUT = path.join("test-results", "visual-review");

export interface VisualCapture {
  id: string;
  file: string;
  scenario: string;
  criteria: string[];
}

const writeManifest = (captures: VisualCapture[]) => {
  fs.mkdirSync(VISUAL_OUT, { recursive: true });
  fs.writeFileSync(
    path.join(VISUAL_OUT, "manifest.json"),
    JSON.stringify({ captures, capturedAt: new Date().toISOString() }, null, 2),
  );
};

export const test = base.extend<{
  visitSkyView: (params?: Record<string, string>) => Promise<void>;
  captureVisual: (capture: Omit<VisualCapture, "file"> & { page: ReturnType<typeof base.page>; target?: "dome" | "viewport" }) => Promise<string>;
}>({
  visitSkyView: async ({ page }, provide) => {
    const visitSkyView = async (params: Record<string, string> = { date: "2025-07-15" }) => {
      await page.addInitScript(() => {
        localStorage.setItem(
          "skyview-location",
          JSON.stringify({
            state: { location: { lat: 47.3769, lon: 8.5417, name: "Zurich" } },
            version: 0,
          }),
        );
        localStorage.setItem(
          "skyview-filters",
          JSON.stringify({
            state: {
              types: {
                sun: true,
                moon: true,
                stars: true,
                planets: true,
                dsos: true,
                comets: true,
                asteroids: true,
              },
              overlays: { gridLines: true, constellations: false, milkyWay: true },
              magnitudeThreshold: 9,
              altitudeThreshold: -90,
            },
            version: 3,
          }),
        );
      });

      await page.goto(`/?${new URLSearchParams(params).toString()}`);
      await expect(page.locator("#root")).toBeVisible({ timeout: 20_000 });
      const dome = page.locator('[aria-label^="Sky dome"]');
      await expect(dome).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(3_000);
    };
    await provide(visitSkyView);
  },

  captureVisual: async ({}, provide) => {
    const captures: VisualCapture[] = [];
    const manifestPath = path.join(VISUAL_OUT, "manifest.json");

    if (fs.existsSync(manifestPath)) {
      try {
        const prev = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
          captures?: VisualCapture[];
        };
        if (prev.captures) captures.push(...prev.captures);
      } catch {
        /* fresh run */
      }
    }

    const captureVisual = async ({
      page,
      id,
      scenario,
      criteria,
      target = "dome",
    }: Omit<VisualCapture, "file"> & {
      page: ReturnType<typeof base.page>;
      target?: "dome" | "viewport";
    }) => {
      fs.mkdirSync(VISUAL_OUT, { recursive: true });
      const file = `${id}.png`;
      const filePath = path.join(VISUAL_OUT, file);
      if (target === "viewport") {
        await page.screenshot({ path: filePath, animations: "disabled" });
      } else {
        const dome = page.locator('[aria-label^="Sky dome"]');
        await dome.screenshot({ path: filePath, animations: "disabled" });
      }
      captures.push({ id, file, scenario, criteria });
      writeManifest(captures);
      return filePath;
    };

    await provide(captureVisual);
  },
});

export { expect } from "@playwright/test";

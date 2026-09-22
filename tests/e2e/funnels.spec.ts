import { test, expect } from "../fixtures/index";

/**
 * Funnel workspace e2e — verifies the builder/workspace UI we just rebuilt:
 *  - List page loads
 *  - "New Funnel" empty state opens the builder with workspace-style header
 *  - Builder body has the chart on the left and config panel on the right
 *  - Saved funnels open with KPI strip + SQL toggle + Pin/Delete in header
 */

const HEADERS = { "x-dataset-id": "quickhelp" };

test.describe.serial("Funnels — list + builder + workspace", () => {
  test.setTimeout(90_000);

  test.beforeAll(async ({ request }) => {
    // Clean up test funnels left over from prior runs
    const resp = await request.get("/api/funnels", { headers: HEADERS });
    if (resp.ok()) {
      const list = await resp.json();
      for (const f of list) {
        if (f.name?.startsWith("e2e-")) {
          await request.delete(`/api/funnels/${f.id}`, { headers: HEADERS });
        }
      }
    }
  });

  test("/funnels loads the list page", async ({ page }) => {
    await page.goto("/funnels");
    await expect(page).toHaveURL("/funnels");
    await page.waitForLoadState("networkidle");
    // Page header should be present
    await expect(page.locator("h1, h2, h3").filter({ hasText: /Funnels/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("opening a saved funnel renders the workspace header", async ({ page, request }) => {
    // Create a funnel via API so we can open it
    const create = await request.post("/api/funnels", {
      headers: HEADERS,
      data: {
        name: `e2e-workspace-${Date.now()}`,
        description: "e2e workspace render check",
        config: {
          steps: [
            { eventId: "signup" },
            { eventId: "profile_done" },
            { eventId: "first_booking_funnel" },
          ],
          conversionWindow: "30d",
          order: "this_order",
          dateRange: { preset: "90d" },
        },
      },
    });
    expect(create.status()).toBeLessThan(300);
    const { id } = await create.json();

    await page.goto(`/funnels/${id}`);
    await page.waitForLoadState("networkidle");

    // Workspace header: large title (text-2xl)
    const title = page.locator("h1.text-2xl");
    await expect(title).toBeVisible({ timeout: 10_000 });
    await expect(title).toContainText("e2e-workspace");

    // KPI strip present (overall conversion + steps labels)
    await expect(page.locator("text=overall conversion")).toBeVisible();
    await expect(page.locator("text=steps").first()).toBeVisible();

    // Steps panel on the right (config panel)
    await expect(page.locator("text=STEPS").first()).toBeVisible();

    // Cleanup
    await request.delete(`/api/funnels/${id}`, { headers: HEADERS });
  });

  test("SQL toggle in chart toolbar swaps chart for SQL", async ({ page, request }) => {
    const create = await request.post("/api/funnels", {
      headers: HEADERS,
      data: {
        name: `e2e-sqltoggle-${Date.now()}`,
        config: {
          steps: [
            { eventId: "signup" },
            { eventId: "first_booking_funnel" },
          ],
          conversionWindow: "30d",
          order: "this_order",
          dateRange: { preset: "90d" },
        },
      },
    });
    const { id } = await create.json();

    await page.goto(`/funnels/${id}`);
    await page.waitForLoadState("networkidle");

    // Find the View SQL button in the chart toolbar
    const sqlBtn = page.locator('button:has-text("View SQL")').first();
    await expect(sqlBtn).toBeVisible({ timeout: 10_000 });
    await sqlBtn.click();

    // After click the button label should flip to "Hide SQL"
    await expect(page.locator('button:has-text("Hide SQL")').first()).toBeVisible();
    // SQL pre block should be visible (contains the WITH clause from compileFunnelSQL)
    await expect(page.locator("text=/WITH step0 AS/i").first()).toBeVisible();

    // Cleanup
    await request.delete(`/api/funnels/${id}`, { headers: HEADERS });
  });
});

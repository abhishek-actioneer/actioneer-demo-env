import { test, expect } from "../fixtures/index";

/**
 * Retention workspace e2e — verifies the builder/workspace UI:
 *  - List page loads
 *  - Saved retention opens with workspace-style header (D7 KPI, granularity)
 *  - SQL toggle works
 *  - Cohort triangle renders (or empty state)
 */

const HEADERS = { "x-dataset-id": "quickhelp" };

test.describe.serial("Retentions — list + workspace", () => {
  test.setTimeout(90_000);

  test.beforeAll(async ({ request }) => {
    const resp = await request.get("/api/retentions", { headers: HEADERS });
    if (resp.ok()) {
      const list = await resp.json();
      for (const r of list) {
        if (r.name?.startsWith("e2e-")) {
          await request.delete(`/api/retentions/${r.id}`, { headers: HEADERS });
        }
      }
    }
  });

  test("/retentions loads the list page", async ({ page }) => {
    await page.goto("/retentions");
    await expect(page).toHaveURL("/retentions");
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator("h1, h2, h3").filter({ hasText: /Retentions/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("opening a saved retention renders the workspace header", async ({ page, request }) => {
    const create = await request.post("/api/retentions", {
      headers: HEADERS,
      data: {
        name: `e2e-workspace-${Date.now()}`,
        description: "e2e workspace render check",
        config: {
          startEventId: "signup",
          returnEventIds: ["first_booking_funnel"],
          mode: "on_or_after",
          granularity: "daily",
          dateRange: { preset: "30d" },
        },
      },
    });
    expect(create.status()).toBeLessThan(300);
    const { id } = await create.json();

    await page.goto(`/retentions/${id}`);
    await page.waitForLoadState("networkidle");

    const title = page.locator("h1.text-2xl");
    await expect(title).toBeVisible({ timeout: 10_000 });
    await expect(title).toContainText("e2e-workspace");

    // KPI strip: D7 retention + cohorts label
    await expect(page.locator("text=D7 retention")).toBeVisible();
    await expect(page.locator("text=cohorts").first()).toBeVisible();

    // Config panel on the right
    await expect(page.locator("text=STARTING EVENT").first()).toBeVisible();
    await expect(page.locator("text=THEN THE RETURN EVENT").first()).toBeVisible();

    await request.delete(`/api/retentions/${id}`, { headers: HEADERS });
  });

  test("SQL toggle swaps chart for SQL", async ({ page, request }) => {
    const create = await request.post("/api/retentions", {
      headers: HEADERS,
      data: {
        name: `e2e-sqltoggle-${Date.now()}`,
        config: {
          startEventId: "signup",
          returnEventIds: ["first_booking_funnel"],
          mode: "on_or_after",
          granularity: "daily",
          dateRange: { preset: "30d" },
        },
      },
    });
    const { id } = await create.json();

    await page.goto(`/retentions/${id}`);
    await page.waitForLoadState("networkidle");

    const sqlBtn = page.locator('button:has-text("View SQL")').first();
    await expect(sqlBtn).toBeVisible({ timeout: 10_000 });
    await sqlBtn.click();

    await expect(page.locator('button:has-text("Hide SQL")').first()).toBeVisible();
    // Retention SQL has a "cohort AS" CTE
    await expect(page.locator("text=/cohort AS/i").first()).toBeVisible();

    await request.delete(`/api/retentions/${id}`, { headers: HEADERS });
  });
});

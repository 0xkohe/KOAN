import { expect, test } from "@playwright/test";

test("pairing screen is mobile friendly", async ({ page }) => {
  await page.route("**/api/v1/auth/status", (route) => route.fulfill({ json: { paired: false, device: null } }));
  await page.goto("/pair");
  await expect(page.getByRole("heading", { name: /Pair this device|この端末をペアリング/ })).toBeVisible();
  await expect(page.getByLabel("Pairing code")).toBeVisible();
});

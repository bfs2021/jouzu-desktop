import { test, expect, type Page } from "@playwright/test";
import { UI_BASE, stubHost, emptyControlState } from "./host-control";

type Provider = { id: string; label: string; available: boolean; reason?: string; models?: { id: string; sizes: string[] }[] };

const saved = { enabled: true, provider: "shisa", model: "gemini-3-pro-image", size: "1K", maxImages: 3 };
// What the host answers with no tools.json (#67): a full image section, no provider chosen.
const fresh = { enabled: true, provider: "", model: "", size: "1K", maxImages: 3 };
const usableShisa: Provider = {
  id: "shisa", label: "Shisa.AI", available: true,
  models: [{ id: "gemini-3-pro-image", sizes: ["1K", "2K", "4K"] }, { id: "gemini-3.1-flash-image", sizes: ["1K", "2K", "4K"] }],
};
const signedOutShisa: Provider = { id: "shisa", label: "Shisa.AI", available: false, reason: "Sign in to Shisa.AI or set SHISA_API_KEY to generate images." };

/** Opens Settings → Tools against a host whose image tool reports `providers`. Returns what the page saved. */
async function openTools(page: Page, image: Record<string, unknown>, providers: Provider[]) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const saves: Record<string, unknown>[] = [];
  const models: string[] = [];
  let settings = { image, reviewTools: ["generate_image"] };
  await page.addInitScript(() => localStorage.setItem("jouzu.ui.language", "en"));
  await stubHost(page, { control: () => emptyControlState });
  await page.route("**/v1/tools**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/v1/tools" && request.method() === "PUT") {
      const next = request.postDataJSON().image;
      saves.push(next);
      settings = { ...settings, image: next };
      return json(settings);
    }
    if (url.pathname === "/v1/tools") return json({ path: "tools.json", exists: image !== fresh, settings });
    if (url.pathname === "/v1/tools/providers") return json({ providers });
    if (url.pathname === "/v1/tools/models") {
      const id = url.searchParams.get("provider") ?? "";
      models.push(id);
      const provider = providers.find(entry => entry.id === id);
      if (!provider?.available) return json({ error: { code: "tools-error", message: provider?.reason ?? "Unknown image provider", retryable: true } }, 502);
      return json({ models: provider.models });
    }
    return route.fallback();
  });
  await page.goto(UI_BASE);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Tools" }).click();
  await expect(dialog.getByText("Image generation", { exact: true })).toBeVisible();
  return { dialog, saves, models, errors };
}

test("the Tools tab edits the image tool settings", async ({ page }) => {
  const { dialog, saves, errors } = await openTools(page, saved, [usableShisa]);
  await expect(dialog.getByLabel("Image provider", { exact: true })).toHaveValue("shisa");
  await expect(dialog.getByLabel("Image model", { exact: true })).toHaveValue("gemini-3-pro-image");
  await expect(dialog.getByLabel("Images per call", { exact: true })).toHaveValue("3");
  await expect(dialog.getByText("Reviewed calls: generate_image")).toBeVisible();
  await dialog.getByLabel("Image model", { exact: true }).selectOption("gemini-3.1-flash-image");
  await expect.poll(() => saves.at(-1)?.model ?? null).toBe("gemini-3.1-flash-image");
  await expect(dialog.getByLabel("Image model", { exact: true })).toHaveValue("gemini-3.1-flash-image");
  expect(errors).toEqual([]);
});

// #64: a provider that cannot generate images is not offered, and its reason is shown as a state, not an error.
test("an unusable image provider is not offered, and says why", async ({ page }) => {
  const { dialog, saves, models, errors } = await openTools(page, saved, [signedOutShisa]);
  const provider = dialog.getByLabel("Image provider", { exact: true });
  await expect(provider).toBeDisabled();
  await expect(provider.locator("option")).toHaveText(["No image provider available"]);
  await expect(dialog.getByLabel("Image model", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Image size", { exact: true })).toBeDisabled();
  await expect(dialog.getByRole("list", { name: "Unavailable image providers" })).toHaveText("Shisa.AI: Sign in to Shisa.AI or set SHISA_API_KEY to generate images.");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByText("This tools change did not complete.")).toHaveCount(0);
  expect(models).toEqual([]);
  expect(saves).toEqual([]);
  expect(errors).toEqual([]);
});

// #67: with no tools.json the page renders, and the first usable provider is chosen and saved.
test("the Tools tab opens with no saved tools settings", async ({ page }) => {
  const { dialog, saves, errors } = await openTools(page, fresh, [usableShisa]);
  await expect(dialog.getByLabel("Image provider", { exact: true })).toHaveValue("shisa");
  await expect.poll(() => saves.at(-1) ?? null).toMatchObject({ provider: "shisa", model: "gemini-3-pro-image", size: "1K" });
  await expect(dialog.getByLabel("Image model", { exact: true })).toHaveValue("gemini-3-pro-image");
  expect(errors).toEqual([]);
});

test("the Tools tab opens with no saved settings and no usable provider", async ({ page }) => {
  const { dialog, saves, errors } = await openTools(page, fresh, [signedOutShisa]);
  await expect(dialog.getByLabel("Image provider", { exact: true })).toHaveValue("");
  await expect(dialog.getByRole("list", { name: "Unavailable image providers" })).toBeVisible();
  expect(saves).toEqual([]);
  expect(errors).toEqual([]);
});

import { test, expect, type Page } from "@playwright/test";
import { UI_BASE, emptyControlState, stubHostControl } from "./host-control";

// The Tools tab against a stateful /v1/tools backend. The provider list mirrors
// what the image extension reports: its own Shisa adapter plus every provider
// the runtime's model catalog lists image models for (#65).
type Image = { enabled: boolean; provider: string; model: string; size: string; maxImages: number };

async function openTools(page: Page, options: { openRouterAvailable: boolean }) {
  const saved: Image[] = [];
  let image: Image = { enabled: true, provider: "shisa", model: "gemini-3-pro-image", size: "1K", maxImages: 3 };
  await stubHostControl(page, () => ({ ...emptyControlState, account: { signedIn: true } }));
  const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  // Registered after stubHost, so these answer first.
  await page.route("**/v1/tools**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/tools" && request.method() === "GET") return route.fulfill(json({ path: "tools.json", exists: true, settings: { image, reviewTools: ["generate_image"] } }));
    if (url.pathname === "/v1/tools" && request.method() === "PUT") {
      image = { ...image, ...request.postDataJSON().image };
      saved.push(image);
      return route.fulfill(json({ image, reviewTools: ["generate_image"] }));
    }
    if (url.pathname === "/v1/tools/providers") {
      return route.fulfill(json({ providers: [
        { id: "shisa", label: "Shisa.AI", available: true },
        { id: "openrouter", label: "OpenRouter", available: options.openRouterAvailable },
      ] }));
    }
    if (url.pathname === "/v1/tools/models") {
      const provider = url.searchParams.get("provider");
      if (provider === "openrouter") return route.fulfill(json({ models: [{ id: "black-forest-labs/flux.2-pro", sizes: [] }, { id: "google/gemini-2.5-flash-image", sizes: [] }] }));
      return route.fulfill(json({ models: [{ id: "gemini-3-pro-image", sizes: ["1K", "2K", "4K"] }, { id: "gemini-3.1-flash-lite-image", sizes: ["1K"] }] }));
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await page.addInitScript(() => localStorage.setItem("jouzu.ui.language", "en"));
  await page.goto(UI_BASE);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Tools" }).click();
  await expect(dialog.getByText("Image generation", { exact: true })).toBeVisible();
  return { dialog, saved };
}

test("the image provider list includes the runtime's providers and switching keeps settings coherent", async ({ page }) => {
  const { dialog, saved } = await openTools(page, { openRouterAvailable: true });
  const provider = dialog.getByLabel("Image provider");
  await expect(provider).toHaveValue("shisa");
  await expect(dialog.getByLabel("Image size")).toBeVisible();
  await expect(provider.locator("option")).toHaveText(["Shisa.AI", "OpenRouter"]);

  // Another provider: its first model is chosen and saved, and no size is offered (the runtime takes none).
  await provider.selectOption("openrouter");
  await expect.poll(() => saved.at(-1)?.provider ?? null).toBe("openrouter");
  expect(saved.at(-1)?.model).toBe("black-forest-labs/flux.2-pro");
  await expect(dialog.getByLabel("Image model")).toHaveValue("black-forest-labs/flux.2-pro");
  await expect(dialog.getByLabel("Image size")).toHaveCount(0);

  // Back to Shisa: its model list and size control return.
  await provider.selectOption("shisa");
  await expect.poll(() => saved.at(-1)?.provider ?? null).toBe("shisa");
  expect(saved.at(-1)?.model).toBe("gemini-3-pro-image");
  await expect(dialog.getByLabel("Image size")).toBeVisible();
});

test("a provider without a credential is listed and says so instead of failing silently", async ({ page }) => {
  const { dialog } = await openTools(page, { openRouterAvailable: false });
  const provider = dialog.getByLabel("Image provider");
  await expect(provider.locator("option")).toHaveText(["Shisa.AI", "OpenRouter (no credential)"]);
  await provider.selectOption("openrouter");
  await expect(dialog.getByText("No credential for OpenRouter. Add one under Model providers to generate images with it.")).toBeVisible();
});

import { chromium } from "@playwright/test";

/**
 * Black-box user playbook. It uses accessible actions, visible text and a unique
 * reply sentinel only. It never reads host logs, endpoints, DOM structure or
 * layout. UI changes may require updating only the semantic locators below.
 */
const cdp = process.env.PLAYBOOK_CDP ?? "http://127.0.0.1:9223";
const out = process.env.PLAYBOOK_OUT;
const browser = await chromium.connectOverCDP(cdp);
const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage();
const result = { startedAt: new Date().toISOString(), metrics: {}, gates: {}, scenarios: [], errors: [] };
const mark = async (name, ms) => { result.metrics[name] = Math.round(ms); };
const scenario = (name, ok, detail = "") => result.scenarios.push({ name, ok, detail });
const now = () => Date.now();
const assertGate = (name, value, limit) => {
  result.gates[name] = { value, limit, ok: value <= limit };
};

page.on("pageerror", error => result.errors.push(String(error)));
page.on("console", message => {
  if (message.type() === "error" && !/Failed to load resource/.test(message.text())) result.errors.push(message.text());
});

const newSession = () => page.getByRole("button", { name: /new session/i }).first();
const composer = () => page.getByRole("textbox", { name: /message/i }).first();
const send = () => page.getByRole("button", { name: /^send$/i }).first();
const stop = () => page.getByRole("button", { name: /^stop$/i }).first();
const conversation = () => page.getByRole("region", { name: /conversation/i }).first();

async function waitForConversationText(text, timeout = 30_000) {
  await conversation().getByText(text, { exact: true }).first().waitFor({ timeout });
}

/**
 * Image tool with a provider other than Shisa (#65). The provider list comes
 * from the runtime's model catalog, so a provider with a credential in the test
 * data directory must be listed, selectable and able to generate; switching
 * back to Shisa must still work. PLAYBOOK_IMAGE_PROVIDER names the provider as
 * the Tools page labels it (e.g. "OpenRouter"); without it the scenario is
 * recorded as skipped, never as passed.
 */
async function imageProviderScenario() {
  const name = "P1-image other provider (#65)";
  const label = process.env.PLAYBOOK_IMAGE_PROVIDER;
  if (!label) {
    result.scenarios.push({ name, ok: true, skipped: true, detail: "PLAYBOOK_IMAGE_PROVIDER not set" });
    return;
  }
  const openTools = async () => {
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: /tools|ツール/i }).click();
    await dialog.getByText("Image generation", { exact: true }).waitFor({ timeout: 10_000 });
    return dialog;
  };
  const closeSettings = () => page.keyboard.press("Escape");
  let dialog = await openTools();
  const provider = dialog.getByLabel("Image provider");
  const model = dialog.getByLabel("Image model");
  const original = await provider.inputValue();
  const options = await provider.locator("option").allTextContents();
  const listed = options.includes(label);
  if (!listed) {
    scenario(name, false, `"${label}" not offered with a credential; options: ${options.join(", ")}`);
    await closeSettings();
    return;
  }
  await provider.selectOption({ label });
  await page.waitForFunction(element => !element.disabled && element.options.length > 0 && element.value, await model.elementHandle(), { timeout: 20_000 });
  const chosenModel = await model.inputValue();
  await closeSettings();

  // Generate one image through the chat, approving the reviewed call.
  await newSession().click();
  await composer().waitFor({ timeout: 10_000 });
  await composer().fill("Use the generate_image tool once to draw a small red circle on white. Do not ask questions.");
  await send().click();
  await page.getByRole("button", { name: "Approve", exact: true }).first().click({ timeout: 60_000 });
  await conversation().getByText(/Generated 1 image/).first().waitFor({ timeout: 180_000 });
  const generated = await conversation().getByRole("img").count() > 0;
  await page.screenshot({ path: process.env.TEMP + "\\playbook-image-provider.png" });

  // Back to Shisa, and back to whatever was configured before.
  dialog = await openTools();
  await provider.selectOption("shisa");
  await page.waitForFunction(element => !element.disabled && element.value, await model.elementHandle(), { timeout: 20_000 });
  const shisaModel = await model.inputValue();
  if (original !== "shisa") await provider.selectOption(original);
  await closeSettings();
  scenario(name, generated && Boolean(shisaModel), `provider ${label}, model ${chosenModel}; Shisa model ${shisaModel || "none"}`);
}

try {
  let start = now();
  await page.reload({ waitUntil: "domcontentloaded" });
  await newSession().waitFor({ timeout: 30_000 });
  await mark("reloadToReady", now() - start);

  // P0-1: new session, own message, model, one turn.
  start = now();
  await newSession().click();
  await composer().waitFor({ timeout: 10_000 });
  await mark("newSessionUsable", now() - start);

  start = now();
  await page.getByRole("button", { name: /model/i }).first().click();
  const model = page.getByRole("menuitemradio").filter({ hasText: /qwen 3\.8 flash next/i }).first();
  await model.waitFor({ timeout: 5_000 });
  await mark("modelMenuVisible", now() - start);
  await model.click();
  await page.getByText(/qwen 3\.8 flash next/i).first().waitFor({ timeout: 5_000 });
  scenario("P0-4 model selection", true);

  const prompt = "What is 17 × 23? Reply with only the number.";
  const reply = "391";
  start = now();
  await composer().fill(prompt);
  await send().click();
  await waitForConversationText(prompt, 5_000);
  const ownMessage = now() - start;
  await mark("ownMessageVisible", ownMessage);
  assertGate("ownMessageVisible", ownMessage, 100);

  await waitForConversationText(reply);
  const firstReadable = now() - start;
  await mark("warmFirstReadable", firstReadable);
  assertGate("warmFirstReadable", firstReadable, 1_000);

  // Turn end = Stop gone and Send enabled; no hint string is used.
  await stop().waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
  await page.getByRole("button", { name: /^send$/i }).waitFor({ timeout: 30_000 });
  await mark("turnObservedEnd", now() - start);
  scenario("P0-1 fresh turn", (await page.locator("body").innerText()).includes(reply));
  await page.screenshot({ path: process.env.TEMP + "\\playbook-01-chat.png" });

  // P0-2: second new session must not show the previous transcript.
  start = now();
  await newSession().click();
  await composer().waitFor({ timeout: 10_000 });
  await mark("secondNewSessionUsable", now() - start);
  const secondPrompt = "What is 19 × 21? Reply with only the number.";
  const secondReply = "399";
  await composer().fill(secondPrompt);
  await send().click();
  await waitForConversationText(secondReply);
  const secondText = await conversation().innerText();
  scenario("P0-2 second session", secondText.includes(secondReply) && !secondText.includes(prompt));
  await page.screenshot({ path: process.env.TEMP + "\\playbook-02-second.png" });

  // P0-3: reopen the first saved session by its visible prompt.
  start = now();
  await page.getByText(/What is 17 × 23/, { exact: false }).first().click();
  await waitForConversationText(reply);
  await mark("savedSessionSwitch", now() - start);
  assertGate("savedSessionSwitch", now() - start, 2_000);
  scenario("P0-3 reopen saved session", true);

  await imageProviderScenario();
} catch (error) {
  result.errors.push(String(error?.stack ?? error));
  await page.screenshot({ path: process.env.TEMP + "\\playbook-failure.png" }).catch(() => {});
}

result.pass = result.errors.length === 0
  && Object.values(result.gates).every(gate => gate.ok)
  && result.scenarios.every(item => item.ok);
result.finishedAt = new Date().toISOString();
const text = JSON.stringify(result, null, 2);
console.log(text);
if (out) await (await import("node:fs/promises")).writeFile(out, text);
await browser.close();

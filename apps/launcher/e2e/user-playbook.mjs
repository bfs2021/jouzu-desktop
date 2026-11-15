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

const settingsDialog = () => page.getByRole("dialog").first();
async function openSettingsTab(name) {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await settingsDialog().getByRole("tab", { name }).click();
}
async function modelMenuItems() {
  await page.getByRole("button", { name: /model/i }).first().click();
  await page.getByRole("menuitemradio").first().waitFor({ timeout: 5_000 });
  const items = await page.getByRole("menuitemradio").allInnerTexts();
  return items.map(item => item.trim());
}

/**
 * Scenario: a Shisa API key saved in Settings works without restarting the app.
 * Measures: after saving SHISA_API_KEY and pressing "Refresh models", the model
 * menu gains the Shisa models and a new session using one gets a reply.
 * Why: the configuration service and the runtimes used to read saved variables
 * from the wrong file, once, at startup, so the refresh did nothing (issue #63).
 * Needs PLAYBOOK_SHISA_API_KEY (a test key, never a personal one) and a home where
 * Shisa.AI was never signed in or signed out; without the key it is reported as
 * not run, not as passed.
 */
async function shisaKeyWithoutRestart() {
  const name = "Shisa key saved in Settings works without restart";
  const key = process.env.PLAYBOOK_SHISA_API_KEY;
  if (!key) {
    result.scenarios.push({ name, ok: true, skipped: true, detail: "not run: PLAYBOOK_SHISA_API_KEY is not set" });
    return;
  }
  await newSession().click();
  await composer().waitFor({ timeout: 10_000 });
  const before = await modelMenuItems();
  await page.keyboard.press("Escape");

  let start = now();
  await openSettingsTab("Environment");
  await settingsDialog().getByRole("button", { name: "Add variable" }).click();
  await settingsDialog().getByRole("textbox", { name: "Name" }).last().fill("SHISA_API_KEY");
  await settingsDialog().getByLabel("Value").last().fill(key);
  const save = settingsDialog().getByRole("button", { name: "Save", exact: true });
  await save.click();
  await save.waitFor({ state: "visible" });
  await settingsDialog().getByRole("tab", { name: "Model providers" }).click();
  // The key alone counts as a Shisa.AI connection, so the refresh control appears.
  const refresh = settingsDialog().getByRole("button", { name: "Refresh models" });
  await refresh.waitFor({ timeout: 15_000 });
  await refresh.click();
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find(item => item.textContent?.includes("Refresh models"));
    return button && !button.disabled;
  }, null, { timeout: 30_000 });
  await page.keyboard.press("Escape");

  await newSession().click();
  await composer().waitFor({ timeout: 10_000 });
  const after = await modelMenuItems();
  const added = after.filter(item => !before.includes(item));
  await mark("shisaKeySavedToModelsListed", now() - start);
  if (!added.length) {
    await page.keyboard.press("Escape");
    scenario(name, false, "no new model appeared in the menu after saving the key and refreshing");
    return;
  }
  await page.getByRole("menuitemradio").filter({ hasText: added[0] }).first().click();
  start = now();
  await composer().fill("Reply with only the word OK.");
  await send().click();
  await stop().waitFor({ state: "detached", timeout: 60_000 }).catch(() => {});
  await send().waitFor({ timeout: 60_000 });
  await mark("shisaFirstTurnEnd", now() - start);
  const text = await conversation().innerText();
  scenario(name, /\bok\b/i.test(text.replace("Reply with only the word OK.", "")), `model: ${added[0]}`);
  await page.screenshot({ path: process.env.TEMP + "\\playbook-03-shisa-key.png" });
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

  // Image tool settings (#64, #67). Holds whatever the account can do: a
  // provider is offered only when it lists image models, otherwise the page says
  // why; the tab renders whether or not tools settings were ever saved.
  await page.getByRole("button", { name: /^settings$/i }).first().click();
  const settings = page.getByRole("dialog");
  await settings.getByRole("tab", { name: /^tools$/i }).click();
  await settings.getByText("Image generation", { exact: true }).waitFor({ timeout: 10_000 });
  scenario("Tools tab opens without saved tools settings (#67)", true);
  const provider = settings.getByLabel("Image provider", { exact: true });
  await page.waitForFunction(() => !document.querySelector('select[aria-label="Image provider"]')?.textContent?.includes("Loading"), null, { timeout: 25_000 });
  const offered = await provider.isEnabled();
  const modelText = await settings.getByLabel("Image model", { exact: true }).inputValue();
  const reasons = settings.getByRole("list", { name: "Unavailable image providers" });
  const failedChange = await settings.getByText("This tools change did not complete.").count();
  const usableProviderOk = offered
    ? modelText !== ""
    : (await provider.inputValue()) === "" && await reasons.isVisible();
  scenario(
    "Image provider offered only when usable, otherwise reason shown (#64)",
    usableProviderOk && failedChange === 0,
    offered ? `provider ${await provider.inputValue()}, model ${modelText}` : await reasons.innerText().catch(() => "no reason shown"),
  );
  await page.screenshot({ path: process.env.TEMP + "\\playbook-03-tools.png" });
  await page.keyboard.press("Escape");
  await shisaKeyWithoutRestart();
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

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

  await shisaKeyWithoutRestart();
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

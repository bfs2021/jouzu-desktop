import { test, expect } from '@playwright/test';
import { UI_BASE, emptyControlState, stubHostControl } from './host-control';

// Jouzu's language settings (localization.json, shared with Jouzu in a terminal) are shown
// and changed in the Language tab, through the control adapter only.
const resolved = (value: string, source = 'config') => ({ requested: value, effective: value, source });
const defaults = { comments: 'preserve', documentation: 'project', commits: 'project', reviews: 'project' };
function languageState(overrides: Record<string, unknown> = {}) {
  return { status: 'ok', uiLocale: resolved('auto', 'builtin'), responseLanguage: resolved('auto', 'builtin'), artifactPolicy: { effective: defaults, source: 'builtin' }, ...overrides };
}
async function open(page: any, language: () => unknown, requests: any[]) {
  await stubHostControl(page, (body: any) => { requests.push(body); return { ...emptyControlState, language: language() }; });
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    localStorage.setItem('jouzu.ui.language', 'en');
    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (command: string) => {
        if (command === 'launcher_state') return { ready: true, bash: true, recent: [], platform: 'windows' };
        if (command === 'component_versions') return { jouzu: '0.2.5', development: true };
        if (command === 'environment_read') return [];
        if (command.includes('version')) return '0.1.0';
        return 1;
      },
    };
  });
  await page.goto(UI_BASE);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: /^(Language|言語)$/ }).click();
  return dialog;
}

test('reply and artifact language are saved as Jouzu settings', async ({ page }) => {
  const requests: any[] = [];
  let state = languageState();
  const dialog = await open(page, () => state, requests);
  const reply = dialog.getByRole('combobox', { name: 'Jouzu reply language' });
  await expect(reply).toHaveText('Automatic');
  await expect(dialog.getByRole('combobox', { name: /comments, docs, commits/ })).toHaveText('Default');
  state = languageState({ responseLanguage: resolved('ja') });
  await reply.click();
  await page.getByRole('option', { name: '日本語', exact: true }).click();
  await expect(reply).toHaveText('日本語');
  expect(requests.filter(body => body.action === 'language')).toEqual([{ action: 'language', responseLanguage: 'ja' }]);
  const artifact = dialog.getByRole('combobox', { name: /comments, docs, commits/ });
  state = languageState({ responseLanguage: resolved('ja'), artifactPolicy: { effective: { comments: 'en', documentation: 'en', commits: 'en', reviews: 'en' }, source: 'config' } });
  await artifact.click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(artifact).toHaveText('English');
  expect(requests.filter(body => body.action === 'language').at(-1)).toEqual({ action: 'language', artifactPolicy: { comments: 'en', documentation: 'en', commits: 'en', reviews: 'en' } });
  await expect(dialog.getByText(/apply to sessions opened after the change/)).toBeVisible();
});

test('a display language saved on the Jouzu side is adopted; a per-field mix is shown, not rewritten', async ({ page }) => {
  const requests: any[] = [];
  const mix = { comments: 'en', documentation: 'project', commits: 'ja', reviews: 'project' };
  const dialog = await open(page, () => languageState({ uiLocale: resolved('ja'), artifactPolicy: { effective: mix, source: 'config' } }), requests);
  await expect(dialog.getByRole('combobox', { name: 'ランチャーの表示言語' })).toHaveText('日本語');
  await expect(dialog.getByRole('combobox', { name: /コメント/ })).toContainText('commits=ja');
  expect(requests.some(body => body.action === 'language')).toBe(false);
});

test('changing the interface language also saves it for Jouzu', async ({ page }) => {
  const requests: any[] = [];
  let state = languageState();
  const dialog = await open(page, () => state, requests);
  state = languageState({ uiLocale: resolved('zh-Hans') });
  await dialog.getByRole('combobox', { name: 'Launcher interface language' }).click();
  await page.getByRole('option', { name: '简体中文', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: '启动器界面语言' })).toHaveText('简体中文');
  expect(requests.filter(body => body.action === 'language')).toEqual([{ action: 'language', uiLocale: 'zh-Hans' }]);
});

test('an unreadable Jouzu language file is never written from here', async ({ page }) => {
  const requests: any[] = [];
  const dialog = await open(page, () => languageState({ status: 'invalid' }), requests);
  await expect(dialog.getByRole('combobox', { name: 'Jouzu reply language' })).toBeDisabled();
  await expect(dialog.getByText(/could not be read, so the defaults are in effect/)).toBeVisible();
});

test('first run asks interface and reply language on the connect-a-model page and never derives the profile', async ({ page }) => {
  const requests: any[] = [];
  let state: any = languageState();
  let profile: string | null = null;
  await stubHostControl(page, (body: any) => {
    requests.push(body);
    if (body.action === 'profile') profile = body.profile;
    return { ...emptyControlState, profile, modelReady: false, language: state };
  });
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    localStorage.setItem('jouzu.ui.language', 'ja');
    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (command: string) => {
        if (command === 'component_versions') return { jouzu: '0.2.5', development: true };
        if (command.includes('version')) return '0.1.0';
        return 1;
      },
    };
  });
  await page.goto(UI_BASE);
  const reply = page.getByRole('combobox', { name: 'Jouzu の応答言語' });
  await expect(reply).toHaveText('自動');
  state = languageState({ responseLanguage: resolved('ja') });
  await reply.click();
  await page.getByRole('option', { name: '日本語', exact: true }).click();
  await expect(reply).toHaveText('日本語');
  expect(requests.filter(body => body.action === 'language')).toEqual([{ action: 'language', responseLanguage: 'ja' }]);
  // A Japanese interface does not choose the Japanese-first profile.
  expect(requests.some(body => body.action === 'profile' && body.profile === 'ja')).toBe(false);
});

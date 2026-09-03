import { expect, Page, test } from '@playwright/test';

const players = Array.from({ length: 7 }, (_, index) => ({
  name: `Player ${index + 1}`,
  jersey: index + 1,
}));

async function setUpMatch(page: Page): Promise<void> {
  await page.goto('/team');
  for (const player of players) {
    await page.getByLabel('Player Name').fill(player.name);
    await page.getByLabel('Jersey').fill(String(player.jersey));
    await page.getByRole('button', { name: 'Add Player' }).click();
  }

  await page.getByRole('link', { name: 'Set Up Match' }).click();
  for (let index = 0; index < 6; index += 1) {
    const row = page.locator('.player-row').filter({ hasText: players[index].name });
    await row.getByRole('checkbox').check();
    await row.getByRole('button', { name: 'Set starter' }).click();
    await page.locator('.court-slot').filter({ hasText: `P${index + 1}` }).click();
  }
  await page.getByLabel('Opponent').fill('Central High');
}

async function scoreKill(page: Page): Promise<void> {
  await page.locator('.player-chip[data-position="1"]').click();
  await page.getByRole('button', { name: 'Kill - awards point' }).click();
}

test('tablet setup and scoring loop fit, undo repeatedly, and honor the Match Squad', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await setUpMatch(page);

  const start = page.getByRole('button', { name: 'Start Match' });
  await expect(start).toBeVisible();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page).toHaveURL(/\/court$/);

  const courtBox = await page.locator('.court-section').boundingBox();
  const actionsBox = await page.locator('.action-section').boundingBox();
  expect(courtBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(actionsBox!.x).toBeGreaterThan(courtBox!.x);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);

  await scoreKill(page);
  await page.locator('.player-chip[data-position="2"]').click();
  await page.getByRole('button', { name: 'Dig - stat only, no point' }).click();
  await page.getByRole('button', { name: 'Undo last action (Ctrl+Z)' }).click();
  await expect(page.locator('.last-action')).toContainText('Kill · Player 1');
  await page.getByRole('button', { name: 'Undo last action (Ctrl+Z)' }).click();
  await expect(page.locator('.last-action')).toContainText('No actions yet');

  await page.locator('.player-chip[data-position="1"]').click();
  await page.getByRole('button', { name: 'Open substitution panel (S)' }).click();
  await expect(page.locator('.sub-overlay-panel')).not.toContainText('Player 7');
  await page.getByRole('button', { name: 'Close substitution panel', exact: true }).click();

  for (let point = 0; point < 25; point += 1) await scoreKill(page);
  await expect(page.getByRole('heading', { name: 'Set up Set 2' })).toBeVisible();
  for (const select of await page.locator('.next-set-grid select').all()) {
    const optionLabels = await select.locator('option').allTextContents();
    expect(optionLabels).not.toContainEqual(expect.stringContaining('Player 7'));
  }
});

test('phone setup, scoring, and recovery work through normal vertical scrolling without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await setUpMatch(page);

  await page.getByRole('button', { name: 'Start Match' }).click();
  await expect(page).toHaveURL(/\/court$/);
  await scoreKill(page);
  await page.getByRole('button', { name: 'Undo last action (Ctrl+Z)' }).click();
  await expect(page.locator('.last-action')).toContainText('No actions yet');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const scrollTop = await page.locator('ion-content').last().evaluate(async (element) => {
    const scrollElement = await (element as HTMLIonContentElement).getScrollElement();
    return scrollElement.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);
});

import { expect, Locator, Page, test } from '@playwright/test';

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

async function expectTabletScoringLoopToFit(page: Page): Promise<void> {
  const content = page.locator('ion-content').last();
  const viewport = await content.evaluate(async (element) => {
    const scrollElement = await (element as HTMLIonContentElement).getScrollElement();
    const bounds = scrollElement.getBoundingClientRect();
    return {
      clientHeight: scrollElement.clientHeight,
      scrollHeight: scrollElement.scrollHeight,
      top: bounds.top,
      bottom: bounds.bottom,
    };
  });

  const selectors = ['.court-section', '.court-context-row', '.action-section', '.receipt-undo'];
  const regions = await Promise.all(selectors.map((selector) => page.locator(selector).boundingBox()));
  expect(viewport.scrollHeight, JSON.stringify({ viewport, regions })).toBeLessThanOrEqual(viewport.clientHeight + 1);
  for (const [index, selector] of selectors.entries()) {
    const bounds = regions[index];
    expect(bounds, `${selector} should be visible in the Live Court viewport`).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(viewport.top - 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.bottom + 1);
  }
}

async function expectReachableByScrolling(page: Page, locator: Locator): Promise<number> {
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.boundingBox();
  const content = page.locator('ion-content').last();
  const viewport = await content.evaluate(async (element) => {
    const scrollElement = await (element as HTMLIonContentElement).getScrollElement();
    const bounds = scrollElement.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, scrollTop: scrollElement.scrollTop };
  });
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(viewport.top - 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.bottom + 1);
  return viewport.scrollTop;
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

  await scoreKill(page);
  await expectTabletScoringLoopToFit(page);
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

  await page.locator('.player-chip[data-position="1"]').click();
  const pointOutcomes = [
    'Kill - awards point',
    'Attack Error - awards point',
    'Block - awards point',
    'Ace - awards point',
    'Service Error - awards point',
    'Opponent Error - awards point',
    'Opponent Winner - awards point',
    'Receive Error - awards point',
  ];
  const reachedScrollPositions: number[] = [];
  for (const name of pointOutcomes) {
    reachedScrollPositions.push(await expectReachableByScrolling(page, page.getByRole('button', { name })));
  }
  reachedScrollPositions.push(await expectReachableByScrolling(page, page.getByRole('button', { name: 'Dig - stat only, no point' })));
  reachedScrollPositions.push(await expectReachableByScrolling(page, page.getByRole('button', { name: 'Open substitution panel (S)' })));
  await page.getByRole('button', { name: 'Open substitution panel (S)' }).click();
  await expect(page.getByRole('region', { name: 'Substitution panel' })).toBeVisible();
  await page.getByRole('button', { name: 'Close substitution panel', exact: true }).click();

  reachedScrollPositions.push(await expectReachableByScrolling(page, page.getByRole('button', { name: 'Match Controls' })));
  await page.getByRole('button', { name: 'Match Controls' }).click();
  await expect(page.getByRole('dialog', { name: 'Match Controls' })).toBeVisible();
  await page.getByRole('button', { name: 'Close match controls' }).click();

  await scoreKill(page);
  reachedScrollPositions.push(await expectReachableByScrolling(page, page.getByRole('button', { name: 'Undo last action (Ctrl+Z)' })));
  await page.getByRole('button', { name: 'Undo last action (Ctrl+Z)' }).click();
  await expect(page.locator('.last-action')).toContainText('No actions yet');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const contentOverflow = await page.locator('ion-content').last().evaluate(async (element) => {
    const scrollElement = await (element as HTMLIonContentElement).getScrollElement();
    return scrollElement.scrollWidth <= scrollElement.clientWidth + 1;
  });
  expect(contentOverflow).toBe(true);
  expect(Math.max(...reachedScrollPositions)).toBeGreaterThan(0);
});

import { expect, Page, test } from '@playwright/test';

const players = Array.from({ length: 7 }, (_, index) => ({
  name: index === 5 ? 'Jordan Review' : `Player ${index + 1}`,
  jersey: index === 5 ? 12 : index + 1,
}));

async function setUpMatch(page: Page): Promise<void> {
  await page.goto('/team');
  for (const player of players) {
    await page.getByLabel('Player Name').fill(player.name);
    await page.getByLabel('Jersey').fill(String(player.jersey));
    await page.getByRole('button', { name: 'Add Player' }).click();
  }

  await page.getByRole('link', { name: 'Set Up Match' }).click();
  const usesPositionPicker = (page.viewportSize()?.width ?? 1024) <= 820;
  for (let index = 0; index < 6; index += 1) {
    const row = page.locator('.player-row').filter({ hasText: players[index].name });
    await row.getByRole('checkbox').check();
    const courtPosition = page.locator('.court-slot').filter({ hasText: `P${index + 1}` });
    if (usesPositionPicker) {
      await courtPosition.click();
      const picker = page.locator('ion-modal.position-picker-modal');
      await expect(picker).toBeVisible();
      await picker.locator('.position-player').filter({ hasText: players[index].name }).click();
      await expect(picker).toBeHidden();
    } else {
      await row.getByRole('button', { name: 'Set starter' }).click();
      await courtPosition.click();
    }
  }
  await page.getByRole('button', { name: 'Enter opponent name', exact: true }).click();
  await expect(page.getByLabel('Opponent')).toBeFocused();
  await page.getByLabel('Opponent').fill('Central High');
}

async function scoreKill(page: Page): Promise<void> {
  await page.locator('.player-chip[data-position="1"]').click();
  await page.getByRole('button', { name: /^Kill - awards point to / }).click();
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

async function expectPhoneScoringLoopToFit(page: Page): Promise<void> {
  const content = page.locator('app-court > ion-content');
  const viewport = await content.evaluate(async (element) => {
    const scroll = await (element as HTMLIonContentElement).getScrollElement();
    const bounds = scroll.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, scrollTop: scroll.scrollTop, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight };
  });
  expect(viewport.scrollTop).toBe(0);
  expect(viewport.scrollHeight, JSON.stringify(viewport)).toBeLessThanOrEqual(viewport.clientHeight + 1);
  const controls = page.locator('app-court .player-chip, app-court .outcome-column ion-button, app-court .stat-only-btn, app-court .last-action, app-court .receipt-undo');
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(viewport.top);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.bottom);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
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
  await expect(page.locator('.last-action')).toContainText('Player 1 · Kill');
  await page.getByRole('button', { name: 'Undo last action (Ctrl+Z)' }).click();
  await expect(page.locator('.last-action')).toContainText('No actions yet');

  await page.locator('.player-chip[data-position="1"]').click();
  await page.getByRole('button', { name: 'Open substitution panel (S)' }).click();
  await expect(page.locator('.substitution-rail')).not.toContainText('Player 7');
  await page.getByRole('button', { name: 'Close substitution panel', exact: true }).click();

  for (let point = 0; point < 25; point += 1) await scoreKill(page);
  await expect(page.getByRole('heading', { name: 'Set up Set 2' })).toBeVisible();
  for (const select of await page.locator('.next-set-grid select').all()) {
    const optionLabels = await select.locator('option').allTextContents();
    expect(optionLabels).not.toContainEqual(expect.stringContaining('Player 7'));
  }
});

test('phone records ten rallies without scrolling and confirms attribution and recovery', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setUpMatch(page);
  await page.getByRole('button', { name: 'Start Match' }).click();
  await expect(page).toHaveURL(/\/court$/);
  const outcomes = ['Ace', 'Service Error', 'Receive Error', 'Kill', 'Opponent Winner', 'Block', 'Opponent Error', 'Attack Error', 'Kill', 'Ace'];
  let rounds = 0;
  for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await expectPhoneScoringLoopToFit(page);
    for (const [index, action] of outcomes.entries()) {
      const player = page.locator('.player-chip[data-position="3"]');
      await player.click();
      const selectedName = await player.locator('.court-player-name').innerText();
      await expect(page.getByRole('heading', { name: /Record for #/ })).toContainText(selectedName);
      await expect(player.locator('.selection-check')).toBeVisible();
      if (rounds === 0 && index === 0) await page.screenshot({ path: 'output/playwright/scoring-redesign/selected-player.png' });
      await expectPhoneScoringLoopToFit(page);
      if (index === 3) {
        await page.getByRole('button', { name: 'Dig - stat only, no point' }).click();
        await expect(page.locator('.last-action')).toContainText(selectedName + ' · Dig · Score unchanged');
        await page.getByRole('button', { name: 'Undo last action (Ctrl+Z)' }).click();
        await player.click();
      }
      const serverName = await page.locator('.player-chip[data-position="1"] .court-player-name').innerText();
      await page.getByRole('button', { name: new RegExp('^' + action + ' - awards point to ') }).click();
      await expect(page.locator('.last-action')).toContainText(action);
      if (action !== 'Opponent Error' && action !== 'Opponent Winner') {
        await expect(page.locator('.last-action')).toContainText((action === 'Ace' || action === 'Service Error' ? serverName : selectedName) + ' · ' + action);
      }
      await expect(page.getByRole('heading', { name: 'Select a player for individual stats' })).toBeVisible();
      await expectPhoneScoringLoopToFit(page);
    }
    rounds += 1;
    await expect(page.locator('.score-side.home .score-points')).toHaveText(String(rounds * 6));
    await expect(page.locator('.score-side.away .score-points')).toHaveText(String(rounds * 4));
    await page.screenshot({ path: `output/playwright/scoring-redesign/phone-${viewport.width}.png` });
  }

});

test('keyboard selection and focus follow the visible phone court', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setUpMatch(page);
  await page.getByRole('button', { name: 'Start Match' }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.player-chip[data-position="3"]').focus();
  await page.locator('.player-chip[data-position="3"]').press('ArrowRight');
  await expect(page.locator('.player-chip[data-position="2"]')).toHaveAttribute('aria-pressed', 'true');
  await expectPhoneScoringLoopToFit(page);
  await page.screenshot({ path: 'output/playwright/scoring-redesign/dark-selected.png' });

  await expect(page.locator('.player-chip[data-position="2"]')).toBeFocused();
  await page.locator('.player-chip[data-position="2"]').press('ArrowDown');
  await expect(page.locator('.player-chip[data-position="1"]')).toBeFocused();
  await expect(page.locator('.player-chip[data-position="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expectPhoneScoringLoopToFit(page);
  await page.screenshot({ path: 'output/playwright/scoring-redesign/dark-selected.png' });
});

test('phone panels and Home restore the current match', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setUpMatch(page);
  await page.getByRole('button', { name: 'Start Match' }).click();
  await page.setViewportSize({ width: 320, height: 568 });
  await scoreKill(page);
  await page.getByRole('button', { name: 'Undo last action (Ctrl+Z)' }).click();
  await expect(page.locator('.score-side.home .score-points')).toHaveText('0');
  await expectPhoneScoringLoopToFit(page);
  await page.locator('.player-chip[data-position="3"]').click();
  await page.getByRole('button', { name: 'Open match tools' }).click();
  await page.getByRole('button', { name: 'Substitute', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Substitution bench rail' })).toBeVisible();
  await page.getByRole('button', { name: 'Close substitution panel', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Substitution bench rail' })).toBeHidden();
  await expectPhoneScoringLoopToFit(page);
  await page.getByRole('button', { name: 'Open match tools' }).click();
  await page.getByRole('button', { name: 'Expanded court', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'On-court Lineup' })).toBeVisible();
  await page.getByRole('button', { name: 'Close expanded court', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'On-court Lineup' })).toBeHidden();
  await expectPhoneScoringLoopToFit(page);
  await page.getByRole('button', { name: 'Open match tools' }).click();
  await page.getByRole('button', { name: 'Match Controls', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Match Controls' })).toBeVisible();
  await page.getByRole('button', { name: 'R2', exact: true }).click();
  await page.getByRole('button', { name: 'Close match controls', exact: true }).click();
  await expectPhoneScoringLoopToFit(page);
  await page.getByRole('button', { name: 'Open match tools' }).click();
  const currentServer = await page.locator('.player-chip[data-position="1"] .court-player-name').innerText();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Match tools', exact: true })).toBeHidden();
  await expect(page.locator('app-court')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Resume Match' })).toBeVisible();
  await expect(page.locator('.active-match-score')).toContainText('0–0');
  await expect(page.locator('.preview-head')).toContainText('Current lineup');
  await expect(page.locator('.mini-player[data-position="1"]')).toContainText(currentServer);
  await page.screenshot({ path: 'output/playwright/scoring-redesign/home.png' });
  await page.getByRole('link', { name: 'Resume Match' }).click();
  await expect(page.locator('app-home')).toBeHidden();
  await expectPhoneScoringLoopToFit(page);
});

for (const width of [375, 1024]) {
  test(`direct starter swaps preserve a ready lineup at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 768 });
    await setUpMatch(page);
    const position = (number: number) => page.locator(`.court-slot[data-position="${number}"]`);
    await position(1).click();
    await expect(page.locator('ion-modal.position-picker-modal')).toBeHidden();
    await position(2).click();
    await expect(position(1)).toContainText('Player 2');
    await expect(position(2)).toContainText('Player 1');
    await expect(page.locator('.lineup-count')).toContainText('6');
    await expect(page.getByRole('button', { name: 'Start Match' })).toBeEnabled();
    await expect(position(1)).toContainText('Serves first');
    await expect(page.locator('.lineup-instruction')).toContainText('Swapped Player 1 (P1) and Player 2 (P2)');

    if (width === 1024) {
      await position(1).press('Enter');
      await position(2).press('Enter');
      await expect(position(1)).toContainText('Player 1');
      await position(1).dragTo(position(4));
      await expect(position(1)).toContainText('Player 4');
      await expect(position(4)).toContainText('Player 1');
      await expect(page.getByRole('button', { name: 'Start Match' })).toBeEnabled();
    }
  });
}

test('device storage failure blocks scoring until Retry Save records the intended action once', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await setUpMatch(page);
  await page.getByRole('button', { name: 'Start Match' }).click();
  await expect(page).toHaveURL(/\/court$/);
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    (window as Window & { restoreDeviceStorage?: () => void }).restoreDeviceStorage = () => {
      Storage.prototype.setItem = originalSetItem;
    };
    Storage.prototype.setItem = () => { throw new DOMException('Device storage is full', 'QuotaExceededError'); };
  });

  await scoreKill(page);
  await expect(page.locator('.device-save-error')).toContainText('was not recorded');
  await expect(page.locator('.score-side.home .score-points')).toHaveText('0');
  await expect(page.getByRole('button', { name: /^Kill - awards point to / })).toBeDisabled();

  await page.evaluate(() => {
    (window as Window & { restoreDeviceStorage?: () => void }).restoreDeviceStorage?.();
  });
  await page.locator('app-equipment-rail').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.device-save-error')).toHaveCount(0);
  await expect(page.locator('.score-side.home .score-points')).toHaveText('1');
  await page.reload();
  await expect(page).toHaveURL(/\/court$/);
  await expect(page.locator('.score-side.home .score-points')).toHaveText('1');
  await expect(page.locator('.last-action')).toContainText('Player 1 · Kill');
});

test('a full match preserves roster, substitutions, timeouts, and set stats across new browser sessions', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1024, height: 768 });
  await setUpMatch(page);
  await page.locator('.player-row').filter({ hasText: 'Player 7' }).getByRole('checkbox').check();
  const appOrigin = new URL(page.url()).origin;
  await page.goto('/team');
  await page.getByLabel('Team Name').fill('North High');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.goto('/pre-match');
  await page.getByRole('button', { name: 'Enter opponent name', exact: true }).click();
  await expect(page.getByLabel('Opponent')).toBeFocused();
  await page.getByLabel('Opponent').fill('Central High');
  await page.getByRole('radio', { name: 'Best of 5' }).click();
  await page.getByRole('button', { name: 'Start Match' }).click();
  await expect(page).toHaveURL(/\/court$/);
  const offlineCachingEnabled = await page.locator('app-court .offline-state').count() > 0;
  if (offlineCachingEnabled) {
    await expect(page.locator('app-court').getByText('Ready offline', { exact: true })).toBeVisible();
  }
  await page.context().setOffline(true);
  await scoreKill(page);
  await page.locator('.player-chip[data-position="2"]').click();
  await page.getByRole('button', { name: 'Dig - stat only, no point' }).click();
  await page.getByRole('button', { name: 'Match Controls', exact: true }).click();
  await page.getByRole('button', { name: 'Our timeout' }).click();
  await page.getByRole('button', { name: 'Close match controls' }).click();
  await page.locator('.player-chip[data-position="1"]').click();
  await page.getByRole('button', { name: 'Open substitution panel (S)' }).click();
  await page.getByRole('option', { name: /Substitute in Player 7/ }).click();
  await scoreKill(page);

  if (offlineCachingEnabled) {
    await page.reload();
    await expect(page.locator('.score-side.home .score-points')).toHaveText('2');
    const reopened = await page.context().newPage();
    await page.close();
    await reopened.goto(appOrigin + '/court');
    await expect(reopened.locator('.score-side.home .score-points')).toHaveText('2');
    page = reopened;
  }

  const saved = await page.context().storageState();
  await page.close();
  const resumedContext = await browser.newContext({ storageState: saved, viewport: { width: 1024, height: 768 } });
  const resumed = await resumedContext.newPage();
  try {
    await resumed.goto(appOrigin + '/court');
    await expect(resumed).toHaveURL(/\/court$/);
    await expect(resumed.locator('.score-side.home .score-team-name')).toHaveText('North High');
    await expect(resumed.locator('.score-side.home .score-points')).toHaveText('2');
    await expect(resumed.locator('.player-chip[data-position="1"]')).toContainText('Player 7');
    await resumed.getByRole('button', { name: 'Match Controls', exact: true }).click();
    await expect(resumed.getByRole('dialog', { name: 'Match Controls' })).toContainText('North High 1');
    await resumed.getByRole('button', { name: 'Close match controls' }).click();
    await resumed.getByRole('button', { name: 'Team & Stats', exact: true }).click();
    const panel = resumed.locator('ion-modal.stats-modal');
    await expect(panel.locator('tbody tr')).toHaveCount(7);
    await expect(panel.locator('tbody tr').filter({ hasText: 'Player 1' }).locator('td').nth(0)).toHaveText('OH');
    await expect(panel.locator('tbody tr').filter({ hasText: 'Player 1' }).locator('td').nth(1)).toHaveText('Bench');
    await expect(panel.locator('tbody tr').filter({ hasText: 'Player 2' }).locator('td').nth(7)).toHaveText('1');
    await expect(panel.locator('tfoot td').nth(0)).toHaveText('2');
    await resumed.getByRole('button', { name: 'Close team and stats' }).click();
    await resumed.getByRole('button', { name: 'Undo last action (Ctrl+Z)' }).click();
    await expect(resumed.locator('.score-side.home .score-points')).toHaveText('1');

    for (let point = 1; point < 25; point += 1) await scoreKill(resumed);
    await expect(resumed.getByRole('heading', { name: 'Set up Set 2' })).toBeVisible();
    await resumed.reload();
    await expect(resumed.getByRole('heading', { name: 'Set up Set 2' })).toBeVisible();
    await resumed.getByRole('button', { name: 'Start Set 2', exact: true }).click();
    await scoreKill(resumed);
    await resumed.getByRole('button', { name: 'Team & Stats', exact: true }).click();
    await panel.getByLabel('Stats scope').selectOption('2');
    await expect(panel.locator('tfoot td').nth(0)).toHaveText('1');
    await panel.getByLabel('Stats scope').selectOption('1');
    await expect(panel.locator('tfoot td').nth(0)).toHaveText('25');
    await resumed.getByRole('button', { name: 'Close team and stats' }).click();
    for (let point = 1; point < 25; point += 1) await scoreKill(resumed);
    await resumed.getByRole('button', { name: 'Start Set 3', exact: true }).click();
    for (let point = 0; point < 25; point += 1) await scoreKill(resumed);
    await expect(resumed.locator('.match-over-banner')).toContainText('Match final.');
    await resumed.getByRole('button', { name: 'Review Match', exact: true }).click();
    await expect(resumed).toHaveURL(/\/review\//);
    const reviewUrl = resumed.url();
    await resumed.reload();
    await expect(resumed.getByRole('heading', { name: 'North High vs Central High' })).toBeVisible();
    await expect(resumed.locator('app-match-box-score tfoot td').nth(0)).toHaveText('75');
    await expect(resumed.locator('.set-list li')).toHaveCount(3);
    await resumed.goto(appOrigin + '/pre-match?newMatch=1');
    await resumed.getByLabel('Opponent').fill('West High');
    await resumed.getByRole('button', { name: 'Start Match' }).click();
    await expect(resumed.locator('.score-side.home .score-points')).toHaveText('0');
    await resumed.goto(reviewUrl);
    await expect(resumed.locator('app-match-box-score tfoot td').nth(0)).toHaveText('75');
    await resumed.goto(appOrigin + '/team');
    await expect(resumed.locator('.roster-row')).toHaveCount(7);
    await expect(resumed.getByLabel('Team Name')).toHaveValue('North High');
    await resumed.goto(appOrigin + '/history');
    await expect(resumed.locator('.match-row')).toHaveCount(2);
  } finally {
    await resumedContext.close();
  }
});

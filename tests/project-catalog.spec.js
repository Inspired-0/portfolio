const { test, expect } = require('@playwright/test');

for (const width of [360, 1440]) {
  test(`every project restores its description and keyboard focus at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const links = page.locator('[data-case-link]');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const link = links.nth(index);
      const target = await link.getAttribute('href');
      const owner = await link.evaluate(element => element.closest('.case-card').id);
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator(`#case-dialog-body ${target}`)).toBeVisible();
      await expect(page.locator(target)).toHaveCount(1);
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.querySelector('#case-dialog').contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.locator('#case-dialog')).toBeHidden();
      await expect(page.locator(`#${owner} > ${target}`)).toHaveCount(1);
      await expect(link).toBeFocused();
    }
  });
}

test('all project descriptions are exposed in print', async ({ page }) => {
  await page.goto('/');
  await page.emulateMedia({ media: 'print' });
  const details = page.locator('[data-case-details]');
  for (let index = 0; index < await details.count(); index += 1) {
    await expect(details.nth(index)).toBeVisible();
  }
  await expect(page.locator('#case-dialog')).toBeHidden();
});

test('enlarged text reflows on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/');
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  const email = page.locator('#contacts a[href^="mailto:"]');
  await email.focus();
  await expect(email).toBeInViewport();
});

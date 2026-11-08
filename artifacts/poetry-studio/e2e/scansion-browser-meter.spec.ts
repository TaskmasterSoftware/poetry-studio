import { expect, test } from '@playwright/test';

test('shows local English meter estimates without calling a scansion service', async ({ page }) => {
  const remoteScansionRequests: string[] = [];
  page.on('request', (request) => {
    if (/calliope|huggingface|\/api\/scansion/i.test(request.url())) {
      remoteScansionRequests.push(request.url());
    }
  });

  await page.goto('/');
  await page.getByTestId('nav-scansion').click();
  await expect(page.getByTestId('meter-estimate-note')).toContainText(/browser-only prototype/i);

  const firstLine = page.getByTestId('meter-estimate-line-1');
  await expect(firstLine).toBeVisible();
  await expect(firstLine).not.toContainText('Analyzing locally…');
  await expect(firstLine).toContainText(/fit|No clear regular meter/);
  await expect(page.getByTestId('toggle-scansion')).toBeVisible();
  expect(remoteScansionRequests).toEqual([]);
});

test('runs the meter fit against the poem text in the browser', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('editor-manuscript').fill("Shall I compare thee to a summer's day?");
  await page.getByTestId('nav-scansion').click();

  const firstLine = page.getByTestId('meter-estimate-line-1');
  await expect(firstLine).not.toContainText('Analyzing locally…');
  await expect(firstLine).toContainText(/pentameter|No clear regular meter|Closest fit/);
});

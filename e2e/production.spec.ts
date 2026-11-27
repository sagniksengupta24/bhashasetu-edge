import { expect, test } from '@playwright/test';

test.describe('BhashaSetu Edge Production E2E', () => {
  test('1. Zero-Key Boot & Ephemeral Reload Safety (zero pageerrors)', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', (err) => errors.push(err));

    await page.goto('/');
    await expect(page.getByText('Select patient language.')).toBeVisible();
    await expect(page.getByText('Session Encryption Active · Set Passphrase to Lock')).toBeVisible();

    // Run Simulator scenario 1 and save encounter in ephemeral session
    await page.getByRole('button', { name: 'Simulate' }).click();
    await page.getByText('Compound Explicit Negation').click();
    await expect(page.getByText('Chest Pain')).toBeVisible();
    await page.getByRole('button', { name: /Encrypt & Trigger Emergency Referral/i }).click();
    await expect(page.getByText('Immediate doctor referral required.')).toBeVisible();

    // Hard reload: ephemeral rows should be pruned cleanly without uncaught OperationError
    await page.reload();
    await expect(page.getByText('Select patient language.')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('2. True Offline Reload via Workbox Service Worker', async ({ page, context }) => {
    const errors: Error[] = [];
    page.on('pageerror', (err) => errors.push(err));

    await page.goto('/');
    await expect(page.getByText('Select patient language.')).toBeVisible();

    // Wait for Service Worker to register and activate
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready;
      }
    });

    // Go offline and reload
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText('Select patient language.')).toBeVisible();

    // Run Simulator scenario 2 and queue encounter while offline
    await page.getByRole('button', { name: 'Simulate' }).click();
    await page.getByText('Resolved Fever + Chest Heaviness').click();
    await page.getByRole('button', { name: /Encrypt & Trigger Emergency Referral/i }).click();
    await page.getByRole('button', { name: 'Open Queue' }).click();

    await expect(page.getByText('QUEUED').first()).toBeVisible();
    await expect(page.getByText('ACKED')).toHaveCount(0);
    await context.setOffline(false);
    expect(errors).toEqual([]);
  });

  test('3. Passphrase Vault + Encrypted Draft Survival on Lock', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', (err) => errors.push(err));

    await page.goto('/');
    await page.getByText('Session Encryption Active · Set Passphrase to Lock').click();

    // Create 6-digit PIN 123456
    for (const digit of ['1', '2', '3', '4', '5', '6']) {
      await page.getByRole('button', { name: digit, exact: true }).click();
    }
    await expect(page.getByText('Select patient language.')).toBeVisible();

    // Start an intake halfway through (Step 3)
    await page.getByRole('button', { name: /Hinglish/i }).click();
    await page.getByRole('button', { name: /Confirm Consent/i }).click();
    await page
      .getByPlaceholder('Or enter Hindi / Hinglish / Bengali phrase…')
      .fill('do din se tej bukhar hai');
    await page.getByRole('button', { name: 'Parse' }).click();
    await expect(page.getByText('Step 03 · Structured Intake')).toBeVisible();

    // Wait briefly for debounced DRAFT autosave, then lock vault
    await page.waitForTimeout(750);
    await page.getByRole('button', { name: 'Lock AES-256-GCM Vault' }).click();
    await expect(page.getByText('Unlock ASHA Vault')).toBeVisible();

    // Unlock with 123456
    for (const digit of ['1', '2', '3', '4', '5', '6']) {
      await page.getByRole('button', { name: digit, exact: true }).click();
    }
    await expect(page.getByText('Select patient language.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Encrypted Draft Saved · Resume Intake')).toBeVisible();
    await page.getByText('Encrypted Draft Saved · Resume Intake').click();
    await expect(page.getByText('Step 03 · Structured Intake')).toBeVisible();
    await expect(page.getByText('High Fever')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('4. Form Validation blocks invalid age (999) and malformed ABHA ID', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', (err) => errors.push(err));

    await page.goto('/');
    await page.getByRole('button', { name: /Hinglish/i }).click();
    await page.getByRole('button', { name: /Add Patient Identity/i }).click();

    await page.getByPlaceholder('Age (yrs)').fill('999');
    await page.getByPlaceholder('Optional ABHA ID (XX-XXXX-XXXX-XXXX)').fill('bad-abha');
    await page.getByRole('button', { name: 'Save Patient Details' }).click();

    await expect(page.getByText('Age must be between 0 and 120.')).toBeVisible();
    await expect(
      page.getByText('ABHA ID must match XX-XXXX-XXXX-XXXX (14 digits).')
    ).toBeVisible();

    // Fix inputs and save
    await page.getByPlaceholder('Age (yrs)').fill('42');
    await page.getByPlaceholder('Optional ABHA ID (XX-XXXX-XXXX-XXXX)').fill('24-5819-4402-9104');
    await page.getByRole('button', { name: 'Save Patient Details' }).click();
    await expect(page.getByText('42y / F')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('5. Honest Sync State Machine: 400 -> FAILED_4XX, 503 -> FAILED_RETRYABLE, 201 -> ACKED', async ({
    page,
  }) => {
    const errors: Error[] = [];
    page.on('pageerror', (err) => errors.push(err));

    let mode: '400' | '503' | '201' = '400';
    await page.route('**/api/abdm/fhir-intake', async (route) => {
      if (mode === '400') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Schema validation error' }),
        });
      } else if (mode === '503') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Service unavailable' }),
        });
      } else {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'acked', encounter_id: 'test' }),
        });
      }
    });

    await page.goto('/');
    // Ensure Online toggle is ON
    const onlinePill = page.locator('header button').filter({ hasText: /^(ON|OFF)$/ });
    if ((await onlinePill.textContent())?.trim() === 'OFF') {
      await onlinePill.click();
    }

    // 1) 400 -> FAILED_4XX
    await page.getByRole('button', { name: 'Queue' }).click();
    await page.getByRole('button', { name: /Sync \(/i }).click();
    await expect(page.getByText('FAILED_4XX')).toBeVisible();

    // 2) Create another encounter and test 503 -> FAILED_RETRYABLE
    mode = '503';
    await page.getByRole('button', { name: 'Simulate', exact: true }).click();
    await page.getByText('Compound Explicit Negation').click();
    await page.getByRole('button', { name: /Encrypt & Trigger Emergency Referral/i }).click();
    await page.getByRole('button', { name: 'Open Queue' }).click();
    await page.getByRole('button', { name: /Sync \(/i }).click();
    await expect(page.getByText('FAILED_RETRYABLE')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/retries:/i).first()).toBeVisible();

    // 3) Retry with 201 -> ACKED
    mode = '201';
    await page.getByRole('button', { name: /Sync \(/i }).click();
    await expect(page.getByText('ACKED', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

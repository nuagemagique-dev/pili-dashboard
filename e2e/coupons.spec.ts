import { expect, test } from './support/test'
import { fillCouponForm } from './support/coupons'
import { message } from './support/messages'

/* The coupons page on a desktop: the table and the create dialog. */

test.describe('coupons (desktop)', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fr/coupons')
    await expect(page.getByRole('cell', { name: 'WELCOME10' })).toBeVisible()
  })

  test('a new percentage coupon is created and listed', async ({
    authenticatedPage: page,
    mock,
  }) => {
    await page.getByRole('button', { name: message('coupons.add') }).click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', { name: message('coupons.createTitle') }),
    ).toBeVisible()
    await fillCouponForm(dialog, { code: 'sakura5', value: '5' })
    await dialog.getByRole('button', { name: message('common.create') }).click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('cell', { name: 'SAKURA5' })).toBeVisible()
    const [call] = await mock.operations('createCoupon')
    expect(call?.args).toMatchObject({
      input: {
        code: 'SAKURA5',
        discountType: 'PERCENTAGE',
        discountValue: 5,
        isActive: true,
        appOnly: false,
      },
    })
    expect((await mock.state()).coupons.map((coupon) => coupon.code)).toContain('SAKURA5')
  })

  test('a coupon without a value is not sent', async ({ authenticatedPage: page, mock }) => {
    await page.getByRole('button', { name: message('coupons.add') }).click()
    const dialog = page.getByRole('dialog')
    await fillCouponForm(dialog, { code: 'EMPTY', value: '' })
    await dialog.getByRole('button', { name: message('common.create') }).click()

    await expect(dialog).toBeVisible()
    expect(await mock.operations('createCoupon')).toHaveLength(0)
  })

  test('a refused coupon keeps the dialog open and reports the failure', async ({
    authenticatedPage: page,
    mock,
  }) => {
    await mock.failOperation('createCoupon', { code: 'INTERNAL' })
    await page.getByRole('button', { name: message('coupons.add') }).click()
    const dialog = page.getByRole('dialog')
    await fillCouponForm(dialog, { code: 'BROKEN', value: '5' })
    await dialog.getByRole('button', { name: message('common.create') }).click()

    await expect(
      page.getByText(message('coupons.errors.saveFailed'), { exact: true }),
    ).toBeVisible()
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('cell', { name: 'BROKEN' })).toHaveCount(0)
  })
})

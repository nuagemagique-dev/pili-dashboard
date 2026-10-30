import { expect, test } from './support/test'
import { fillCouponForm } from './support/coupons'
import { message } from './support/messages'

/* The coupons page on a phone: the same creation, in the full-screen sheet. */

test('a coupon is created from the phone sheet', async ({ authenticatedPage: page, mock }) => {
  await page.goto('/fr/coupons')
  await expect(page.getByText('WELCOME10').first()).toBeVisible()

  await page.getByRole('button', { name: message('coupons.addShort') }).click()
  const sheet = page.getByRole('dialog')
  await expect(
    sheet.getByRole('heading', { name: message('coupons.createTitle') }).first(),
  ).toBeVisible()
  await fillCouponForm(sheet, { code: 'phone7', value: '7' })
  await sheet.getByRole('button', { name: message('common.create') }).click()

  await expect(page.getByText('PHONE7').first()).toBeVisible()
  const [call] = await mock.operations('createCoupon')
  expect(call?.args).toMatchObject({ input: { code: 'PHONE7', discountValue: 7 } })
})

import type { Locator } from '@playwright/test'
import { message } from './messages'

/** The input of the coupon form under the label with that text (the form's labels are not bound to their inputs). */
export const couponField = (form: Locator, labelKey: string): Locator =>
  form.locator(`div:has(> label:text-is("${message(labelKey)}")) input`)

export async function fillCouponForm(
  form: Locator,
  values: { code: string; value: string },
): Promise<void> {
  await couponField(form, 'coupons.code').fill(values.code)
  await couponField(form, 'coupons.value').fill(values.value)
}

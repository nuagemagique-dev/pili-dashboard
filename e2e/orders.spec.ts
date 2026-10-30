import type { Locator, Page } from '@playwright/test'
import { expect, test } from './support/test'
import { message } from './support/messages'

/* The orders board on a desktop: the kanban columns and the slideover that changes an order. */

const column = (page: Page, key: string): Locator => page.locator(`[data-column-key="${key}"]`)

const openCard = async (page: Page, key: string, customer: string): Promise<Locator> => {
  await column(page, key).getByText(customer).click()
  const slideover = page.getByRole('dialog')
  await expect(slideover.getByRole('heading', { name: customer })).toBeVisible()
  return slideover
}

test.describe('orders board (desktop)', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fr/orders')
    await expect(column(page, 'NEW').getByText('Alice Martin')).toBeVisible()
  })

  test('every order is in the column of its status', async ({ authenticatedPage: page }) => {
    await expect(column(page, 'NEW').getByText('Bob Dupont')).toBeVisible()
    await expect(column(page, 'PREPARING').getByText('Chloe Lambert')).toBeVisible()
    await expect(column(page, 'AWAITING_PICK_UP').getByText('David Renard')).toBeVisible()
    await expect(
      column(page, 'OUT_FOR_DELIVERY').getByText(message('orders.noOrders')),
    ).toBeVisible()
    await expect(column(page, 'COMPLETED').getByText(message('orders.noOrders'))).toBeVisible()
  })

  test('an order that arrives while the board is open shows up in the new column', async ({
    authenticatedPage: page,
    mock,
  }) => {
    await mock.waitForSubscription('orderCreated')
    await mock.newOrder({
      id: 'order-live',
      status: 'PENDING',
      type: 'PICKUP',
      customer: 'Emma Live',
      minutesAgo: 0,
      lines: [{ product: 'prod-cola', quantity: 1 }],
    })
    await expect(column(page, 'NEW').getByText('Emma Live')).toBeVisible()
  })

  test('the slideover shows the items, the total and the payment of the order', async ({
    authenticatedPage: page,
  }) => {
    const slideover = await openCard(page, 'NEW', 'Bob Dupont')
    await expect(slideover.getByText('Sushi thon')).toBeVisible()
    await expect(slideover.getByText('Cola')).toBeVisible()
    // 2 x 5,00 + 2 x 2,50 + 2,50 delivery fee
    await expect(slideover.getByText('17,50')).toBeVisible()
    await expect(slideover.getByText(message('orders.paymentMethod.online'))).toBeVisible()
  })

  test('starting the preparation sends updateOrder and moves the order', async ({
    authenticatedPage: page,
    mock,
  }) => {
    const slideover = await openCard(page, 'NEW', 'Alice Martin')
    await slideover.getByRole('button', { name: message('orders.status.preparing') }).click()

    await expect(column(page, 'PREPARING').getByText('Alice Martin')).toBeVisible()
    await expect(column(page, 'NEW').getByText('Alice Martin')).toHaveCount(0)
    const calls = await mock.operations('updateOrder')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toMatchObject({ id: 'order-pending', input: { status: 'PREPARING' } })
  })

  test('confirming a pending order keeps it in the new column with its new status', async ({
    authenticatedPage: page,
    mock,
  }) => {
    await expect(
      column(page, 'NEW').getByText(message('orders.status.pending'), { exact: true }),
    ).toHaveCount(1)
    const slideover = await openCard(page, 'NEW', 'Alice Martin')
    await slideover.getByRole('button', { name: message('orders.status.confirmed') }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    const calls = await mock.operations('updateOrder')
    expect(calls[0]?.args).toMatchObject({ id: 'order-pending', input: { status: 'CONFIRMED' } })
    await expect(column(page, 'NEW').getByText('Alice Martin')).toBeVisible()
    // The "pending" badge is gone: it was the only one in the column (Alice).
    await expect(
      column(page, 'NEW').getByText(message('orders.status.pending'), { exact: true }),
    ).toHaveCount(0)
  })

  test('marking an order ready moves it to the pick-up column', async ({
    authenticatedPage: page,
    mock,
  }) => {
    const slideover = await openCard(page, 'PREPARING', 'Chloe Lambert')
    await slideover.getByRole('button', { name: message('orders.status.awaiting_pick_up') }).click()

    await expect(column(page, 'AWAITING_PICK_UP').getByText('Chloe Lambert')).toBeVisible()
    const calls = await mock.operations('updateOrder')
    expect(calls[0]?.args).toMatchObject({
      id: 'order-preparing',
      input: { status: 'AWAITING_PICK_UP' },
    })
  })

  test('completing a pick-up order moves it to the completed column', async ({
    authenticatedPage: page,
    mock,
  }) => {
    const slideover = await openCard(page, 'AWAITING_PICK_UP', 'David Renard')
    await slideover.getByRole('button', { name: message('orders.status.picked_up') }).click()

    await expect(column(page, 'COMPLETED').getByText('David Renard')).toBeVisible()
    const calls = await mock.operations('updateOrder')
    expect(calls[0]?.args).toMatchObject({ id: 'order-ready', input: { status: 'PICKED_UP' } })
  })

  test('cancelling asks for a confirmation and only then sends the cancellation', async ({
    authenticatedPage: page,
    mock,
  }) => {
    const slideover = await openCard(page, 'NEW', 'Alice Martin')
    await slideover.getByText(message('orders.otherActions')).click()
    await slideover.getByRole('button', { name: message('orders.status.cancelled') }).click()
    await slideover.getByRole('button', { name: message('common.save') }).click()

    // Nothing is sent before the confirmation, which unlocks after a short delay.
    expect(await mock.operations('updateOrder')).toHaveLength(0)
    const dialog = page.getByRole('dialog', { name: message('orders.confirmCancelTitle') })
    await expect(dialog).toBeVisible()
    const confirm = dialog.getByRole('button', { name: message('orders.confirm') })
    await expect(confirm).toBeEnabled({ timeout: 10_000 })
    await confirm.click()

    await expect(column(page, 'COMPLETED').getByText('Alice Martin')).toBeVisible()
    const calls = await mock.operations('updateOrder')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toMatchObject({ id: 'order-pending', input: { status: 'CANCELLED' } })
  })

  test('a refused status change leaves the order where it was and says so', async ({
    authenticatedPage: page,
    mock,
  }) => {
    await mock.failOperation('updateOrder', { code: 'INVALID_STATUS_TRANSITION' })
    const slideover = await openCard(page, 'PREPARING', 'Chloe Lambert')
    await slideover.getByRole('button', { name: message('orders.status.awaiting_pick_up') }).click()

    await expect(
      page.getByText(message('orders.errors.updateFailed'), { exact: true }),
    ).toBeVisible()
    await expect(column(page, 'PREPARING').getByText('Chloe Lambert')).toBeVisible()
    await expect(column(page, 'AWAITING_PICK_UP').getByText('Chloe Lambert')).toHaveCount(0)
  })

  test('a cancellation the payment provider refuses is reported, the order is unchanged', async ({
    authenticatedPage: page,
    mock,
  }) => {
    await mock.failOperation('updateOrder', { code: 'PAYMENT_SETTLEMENT_FAILED' })
    const slideover = await openCard(page, 'NEW', 'Bob Dupont')
    await slideover.getByText(message('orders.otherActions')).click()
    await slideover.getByRole('button', { name: message('orders.status.cancelled') }).click()
    await slideover.getByRole('button', { name: message('common.save') }).click()
    const confirm = page
      .getByRole('dialog', { name: message('orders.confirmCancelTitle') })
      .getByRole('button', { name: message('orders.confirm') })
    await expect(confirm).toBeEnabled({ timeout: 10_000 })
    await confirm.click()

    await expect(
      page.getByText(message('orders.errors.paymentSettlementFailed'), { exact: true }),
    ).toBeVisible()
    expect(
      (await mock.state()).orders.find((order) => order.id === 'order-confirmed')?.status,
    ).toBe('CONFIRMED')
  })

  test('a cash order can be marked as paid', async ({ authenticatedPage: page, mock }) => {
    const slideover = await openCard(page, 'NEW', 'Alice Martin')
    await slideover.getByRole('button', { name: message('orders.payment.markAsPaid') }).click()

    await expect(
      slideover.getByRole('button', { name: message('orders.payment.markAsPaid') }),
    ).toHaveCount(0)
    const calls = await mock.operations('updatePaymentStatus')
    expect(calls[0]?.args).toEqual({ orderId: 'order-pending', status: 'paid' })
  })

  test('an order opened by its address on a wide screen opens in the slideover', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/fr/orders/order-ready')
    await expect(page).toHaveURL(/\/fr\/orders$/u)
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'David Renard' }),
    ).toBeVisible()
  })
})

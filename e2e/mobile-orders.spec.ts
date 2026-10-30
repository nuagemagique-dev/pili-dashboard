import type { Page } from '@playwright/test'
import { expect, test } from './support/test'
import { message } from './support/messages'

/* The orders list and the order page on a phone (Pixel 5): the staff's main screen on the handheld. */

const tab = (page: Page, key: string) =>
  page.getByRole('radio', { name: new RegExp(message(`orders.tabs.${key}`), 'u') })

const card = (page: Page, customer: string) =>
  page.getByRole('button', { name: new RegExp(customer, 'u') })

test.describe('orders (phone)', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fr/orders')
    await expect(card(page, 'Alice Martin')).toBeVisible()
  })

  test('the tabs split the orders by stage', async ({ authenticatedPage: page }) => {
    await expect(card(page, 'Bob Dupont')).toBeVisible()
    await expect(card(page, 'Chloe Lambert')).toBeHidden()

    await tab(page, 'kitchen').click()
    await expect(card(page, 'Chloe Lambert')).toBeVisible()
    await expect(card(page, 'Alice Martin')).toBeHidden()

    await tab(page, 'out').click()
    await expect(card(page, 'David Renard')).toBeVisible()
  })

  test('the one-tap button of a card advances the order', async ({
    authenticatedPage: page,
    mock,
  }) => {
    await page
      .getByRole('button', { name: new RegExp(message('orders.nextAction.confirmed'), 'u') })
      .first()
      .click()

    await expect.poll(async () => (await mock.operations('updateOrder')).length).toBe(1)
    const [call] = await mock.operations('updateOrder')
    expect(call?.args).toMatchObject({ input: { status: 'CONFIRMED' } })
    await expect(page.getByText(message('orders.statusAdvanced'), { exact: true })).toBeVisible()
  })

  test('opening an order shows its page with items, total and the next steps', async ({
    authenticatedPage: page,
  }) => {
    await card(page, 'Bob Dupont').click()

    await expect(page).toHaveURL(/\/fr\/orders\/order-confirmed$/u)
    await expect(page.getByRole('heading', { name: 'Bob Dupont' })).toBeVisible()
    await expect(page.getByText('Sushi thon')).toBeVisible()
    await expect(page.getByText('Cola')).toBeVisible()
    await expect(page.getByText('17,50').first()).toBeVisible()
    await expect(
      page.getByRole('button', { name: message('orders.status.preparing') }),
    ).toBeVisible()
  })

  test('the main action of the order page advances it and goes back to the list', async ({
    authenticatedPage: page,
    mock,
  }) => {
    await card(page, 'Alice Martin').click()
    await expect(page).toHaveURL(/\/fr\/orders\/order-pending$/u)
    await page.getByRole('button', { name: message('orders.status.preparing') }).click()

    await expect(page).toHaveURL(/\/fr\/orders$/u)
    const [call] = await mock.operations('updateOrder')
    expect(call?.args).toMatchObject({ id: 'order-pending', input: { status: 'PREPARING' } })
    await tab(page, 'kitchen').click()
    await expect(card(page, 'Alice Martin')).toBeVisible()
  })

  test('a later estimate is saved without changing the status', async ({
    authenticatedPage: page,
    mock,
  }) => {
    await tab(page, 'kitchen').click()
    await card(page, 'Chloe Lambert').click()
    await expect(page).toHaveURL(/\/fr\/orders\/order-preparing$/u)

    await page.getByRole('radio', { name: '+30' }).click()
    await page.getByRole('button', { name: new RegExp(message('common.save'), 'u') }).click()

    await expect(page.getByText(message('orders.estimateSaved'), { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/fr\/orders\/order-preparing$/u)
    const [call] = await mock.operations('updateOrder')
    expect(call?.args).toMatchObject({ id: 'order-preparing' })
    const input = (call?.args.input ?? {}) as Record<string, unknown>
    expect(input.status).toBeUndefined()
    expect(typeof input.estimatedReadyTime).toBe('string')
  })

  test('cancelling needs the confirmation sheet', async ({ authenticatedPage: page, mock }) => {
    await card(page, 'Alice Martin').click()
    await page.getByRole('button', { name: message('orders.cancelOrder') }).click()

    expect(await mock.operations('updateOrder')).toHaveLength(0)
    const confirm = page.getByRole('button', { name: new RegExp(message('orders.confirm'), 'u') })
    await expect(confirm).toBeEnabled({ timeout: 10_000 })
    await confirm.click()

    await expect(page).toHaveURL(/\/fr\/orders$/u)
    const [call] = await mock.operations('updateOrder')
    expect(call?.args).toMatchObject({ id: 'order-pending', input: { status: 'CANCELLED' } })
    await tab(page, 'done').click()
    await expect(card(page, 'Alice Martin')).toBeVisible()
  })

  test('a cash order is marked as paid from its page', async ({
    authenticatedPage: page,
    mock,
  }) => {
    await card(page, 'Alice Martin').click()
    await page.getByRole('button', { name: message('orders.markPaid') }).click()

    await expect(page.getByRole('button', { name: message('orders.markPaid') })).toHaveCount(0)
    const [call] = await mock.operations('updatePaymentStatus')
    expect(call?.args).toEqual({ orderId: 'order-pending', status: 'paid' })
  })

  test('an order that does not exist says so', async ({ authenticatedPage: page }) => {
    await page.goto('/fr/orders/unknown-order')
    await expect(page.getByText(message('orders.notFound'))).toBeVisible()
  })

  test('the page of an order can be reloaded on its own', async ({ authenticatedPage: page }) => {
    await page.goto('/fr/orders/order-ready')
    await expect(page.getByRole('heading', { name: 'David Renard' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: message('orders.status.picked_up') }),
    ).toBeVisible()
  })
})

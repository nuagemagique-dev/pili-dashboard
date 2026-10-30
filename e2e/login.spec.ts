import { expect, test } from './support/test'
import { message } from './support/messages'

test.describe('sign in', () => {
  test('an anonymous visitor of a protected page is sent to the login page', async ({ page }) => {
    await page.goto('/fr/orders')
    await expect(page).toHaveURL(/\/fr\/auth\/login/u)
    await expect(page.getByRole('heading', { name: message('login.title') })).toBeVisible()
  })

  test('a staff member signs in with the e-mailed code and lands on the orders board', async ({
    page,
    mock,
  }) => {
    await page.goto('/fr/orders')
    await expect(page).toHaveURL(/\/fr\/auth\/login/u)

    await page.getByLabel(message('login.email')).fill('staff@example.test')
    await page.getByRole('button', { name: message('login.sendCode') }).click()
    await expect(
      page.getByText(message('login.codeSent', { email: 'staff@example.test' })),
    ).toBeVisible()

    await page.getByLabel(message('login.codeLabel')).fill('123456')
    await page.getByRole('button', { name: message('login.verify') }).click()

    // The whole round trip ends on the page the visitor first asked for.
    await expect(page).toHaveURL(/\/fr\/orders$/u)
    await expect(page.locator('[data-column-key="NEW"]').getByText('Alice Martin')).toBeVisible()

    const state = await mock.state()
    expect(state.restCalls.map((call) => call.path)).toEqual([
      '/auth/authorize-proxy',
      '/auth/session/otp/request',
      '/auth/session/otp/verify',
      '/auth/finalize',
    ])
    // The board's own requests carry the access token the fake Zitadel issued.
    const orders = state.operations.filter((entry) => entry.op === 'orders')
    expect(orders.length).toBeGreaterThan(0)
    expect(orders.every((entry) => entry.authenticated)).toBe(true)
  })

  test('a wrong code is refused and the staff member can try again', async ({ page, mock }) => {
    await page.goto('/fr/auth/login')
    await page.getByLabel(message('login.email')).fill('staff@example.test')
    await page.getByRole('button', { name: message('login.sendCode') }).click()
    await page.getByLabel(message('login.codeLabel')).fill('000000')
    await page.getByRole('button', { name: message('login.verify') }).click()

    await expect(page.getByRole('alert')).toHaveText(message('login.invalidCode'))
    await expect(page).toHaveURL(/\/fr\/auth\/login/u)
    expect((await mock.state()).restCalls.map((call) => call.path)).not.toContain('/auth/finalize')
  })

  test('an account that is not an administrator is refused after the sign in', async ({
    page,
    mock,
  }) => {
    await mock.nonAdmin()
    await page.goto('/fr/auth/login')
    await page.getByLabel(message('login.email')).fill('customer@example.test')
    await page.getByRole('button', { name: message('login.sendCode') }).click()
    await page.getByLabel(message('login.codeLabel')).fill('123456')
    await page.getByRole('button', { name: message('login.verify') }).click()

    await expect(page.getByText(message('login.accessDenied'))).toBeVisible()
    await expect(page).not.toHaveURL(/\/orders/u)
  })
})

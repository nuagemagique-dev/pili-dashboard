import { expect, test } from './support/test'
import { message } from './support/messages'

/* The products page on a desktop: the table and the edit dialog. */

test.describe('products (desktop)', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fr/products')
    await expect(page.getByRole('cell', { name: 'Sushi saumon' })).toBeVisible()
  })

  test('the table lists the products with their price', async ({ authenticatedPage: page }) => {
    await expect(page.getByRole('cell', { name: 'Sushi thon' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Cola' })).toBeVisible()
    await expect(page.getByRole('row', { name: /Sushi saumon/u })).toContainText('4,50')
  })

  test('editing the price saves the product and updates the table', async ({
    authenticatedPage: page,
    mock,
  }) => {
    await page.getByRole('cell', { name: 'Sushi saumon' }).click()
    const dialog = page.getByRole('dialog', { name: message('products.edit') })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel(message('products.priceEuro')).fill('5.20')
    await dialog.getByRole('button', { name: message('common.save') }).click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('row', { name: /Sushi saumon/u })).toContainText('5,20')
    const [call] = await mock.operations('updateProduct')
    expect(call?.args).toMatchObject({ id: 'prod-saumon', input: { price: 5.2 } })
    expect((await mock.state()).products.find((p) => p.id === 'prod-saumon')?.price).toBe(5.2)
  })

  test('an invalid product is not sent', async ({ authenticatedPage: page, mock }) => {
    await page.getByRole('cell', { name: 'Sushi saumon' }).click()
    const dialog = page.getByRole('dialog', { name: message('products.edit') })
    await dialog.getByLabel(message('products.priceEuro')).fill('-3')
    await dialog.getByRole('button', { name: message('common.save') }).click()

    await expect(dialog.getByText(message('validation.pricePositive'))).toBeVisible()
    expect(await mock.operations('updateProduct')).toHaveLength(0)
  })

  test('a failed save keeps the dialog open and reports the error', async ({
    authenticatedPage: page,
    mock,
  }) => {
    await mock.failOperation('updateProduct', { code: 'INTERNAL' })
    await page.getByRole('cell', { name: 'Sushi saumon' }).click()
    const dialog = page.getByRole('dialog', { name: message('products.edit') })
    await dialog.getByLabel(message('products.priceEuro')).fill('9.99')
    await dialog.getByRole('button', { name: message('common.save') }).click()

    await expect(
      page.getByText(message('orders.errors.updateFailed'), { exact: true }),
    ).toBeVisible()
    await expect(dialog).toBeVisible()
    expect((await mock.state()).products.find((p) => p.id === 'prod-saumon')?.price).toBe('4.50')
  })

  test('a new product is created with its French name and price', async ({
    authenticatedPage: page,
    mock,
  }) => {
    await page.getByRole('button', { name: message('products.add') }).click()
    const dialog = page.getByRole('dialog', { name: message('products.add') })
    await dialog.getByLabel(message('products.priceEuro')).fill('7.9')
    await dialog.getByLabel(`FR ${message('common.name')}`).fill('Maki avocat')
    await dialog.getByRole('button', { name: `${message('products.category')}*` }).click()
    await page.getByRole('option', { name: 'Sushi', exact: true }).click()
    await dialog.getByRole('button', { name: message('common.create') }).click()

    await expect(page.getByRole('cell', { name: 'Maki avocat' })).toBeVisible()
    const [call] = await mock.operations('createProduct')
    expect(call?.args).toMatchObject({
      input: { categoryId: 'cat-sushi', price: 7.9, vatCategory: 'food' },
    })
  })
})

// Dialogs (UModal, the bottom sheet) teleport their content to the body, outside the wrapper: these read it there.
//
//   bodyButton('common.cancel')?.click()
//   bodyText()
export const bodyText = (): string => document.body.textContent ?? ''

export const bodyButton = (text: string): HTMLButtonElement | undefined =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === text)

export const bodyCheckbox = (): HTMLButtonElement | null =>
  document.body.querySelector('button[role="checkbox"]')

export const bodySelector = (selector: string): HTMLElement | null =>
  document.body.querySelector<HTMLElement>(selector)

export const bodyInput = (selector: string): HTMLInputElement | null =>
  document.body.querySelector<HTMLInputElement>(selector)

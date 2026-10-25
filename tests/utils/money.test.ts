// Integer-cents helpers: the API sends decimal strings, sums must not drift and an amount must never show as "NaN €".
import { describe, expect, it } from 'vite-plus/test'
import { centsToEuros, parseCents, sumCents, toCents } from '~/utils/money'

describe('parseCents', () => {
  it.each([
    ['12.50', 1250],
    ['12.5', 1250],
    ['12', 1200],
    ['0.00', 0],
    ['0.07', 7],
    ['.5', 50],
    [' 19.99 ', 1999],
    ['+3.10', 310],
    ['-3.10', -310],
    ['-0.01', -1],
    ['0.005', 1],
    ['0.004', 0],
    ['1.999', 200],
    ['1234567.89', 123456789],
    ['5.', 500],
    ['12,50', 1250],
    ['0,5', 50],
    [',5', 50],
    ['-1.005', -101],
    ['-0', 0],
    ['-0.001', 0],
  ])('reads %s as %d cents', (input, cents) => {
    expect(parseCents(input)).toBe(cents)
  })

  it('reads numbers as euros', () => {
    expect(parseCents(20.5)).toBe(2050)
    expect(parseCents(0.1 + 0.2)).toBe(30)
    expect(parseCents(-4)).toBe(-400)
  })

  // Math.round(x * 100) drifts: 1.005 * 100 = 100.49999999999999. A number rounds like its decimal text does.
  it.each([
    [1.005, 101],
    [1.255, 126],
    [4.35, 435],
    [12.345, 1235],
    [-1.005, -101],
    [-2.5, -250],
    [0.005, 1],
    [0.004, 0],
    [1e-7, 0],
    [-1e-7, 0],
    [0, 0],
    [-0, 0],
    [1234567.89, 123456789],
  ])('reads the number %d as %d cents without float drift', (input, cents) => {
    expect(parseCents(input)).toBe(cents)
  })

  it('rejects a number too large to be an exact amount in cents', () => {
    expect(parseCents(1e21)).toBeNull()
  })

  it.each([
    '',
    ' ',
    'abc',
    '1.2.3',
    '1,2,3',
    '1,234.56',
    '12.5€',
    '.',
    ',',
    '+',
    '1e3',
    'NaN',
    'Infinity',
  ])('rejects the string %j', (input) => {
    expect(parseCents(input)).toBeNull()
  })

  it.each([NaN, Infinity, -Infinity, null, undefined])('rejects %s', (input) => {
    expect(parseCents(input as number)).toBeNull()
  })
})

describe('toCents', () => {
  it('is the value in cents, or 0 when it is not an amount', () => {
    expect(toCents('7.25')).toBe(725)
    expect(toCents(null)).toBe(0)
    expect(toCents(undefined)).toBe(0)
    expect(toCents('n/a')).toBe(0)
  })

  it('sums without the float drift of the decimal strings', () => {
    const lines = ['0.10', '0.20']
    const floatSum = lines.reduce((acc, l) => acc + parseFloat(l), 0)
    expect(floatSum).not.toBe(0.3) // 0.30000000000000004
    expect(lines.reduce((acc, l) => acc + toCents(l), 0)).toBe(30)
  })
})

describe('centsToEuros', () => {
  it('turns cents into the euro amount the formatters take', () => {
    expect(centsToEuros(1250)).toBe(12.5)
    expect(centsToEuros(0)).toBe(0)
    expect(centsToEuros(-5)).toBe(-0.05)
  })
})

describe('sumCents', () => {
  it('sums decimal strings and numbers exactly', () => {
    expect(sumCents(['0.10', '0.20'])).toBe(30)
    expect(sumCents(['19.99', 0.01, '4'])).toBe(2400)
    expect(sumCents([])).toBe(0)
  })

  it('is null as soon as one amount is not readable (a partial sum would be wrong)', () => {
    expect(sumCents(['1.00', 'oops', '2.00'])).toBeNull()
    expect(sumCents(['1.00', null])).toBeNull()
    expect(sumCents([undefined])).toBeNull()
  })
})

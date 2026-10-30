/*
 * All mutable state of the mock tsb-service: the data the dashboard shows, a log of what it asked for, the list of
 * "gaps" (API the dashboard used and the mock lacks) and the pub/sub behind the WebSocket subscriptions.
 */

export type Json = Record<string, unknown>

export interface OperationLog {
  op: string
  kind: 'query' | 'mutation' | 'subscription'
  args: Json
  authenticated: boolean
}

export interface RestLog {
  method: string
  path: string
  body: Json
}

export interface OperationFailure {
  code: string
  message?: string
}

export interface Scenario {
  /** Root fields that answer a GraphQL error (`null` lifts it). */
  operationFailures: Record<string, OperationFailure | undefined>
  /** The `me` query answers a user who is not an admin: the dashboard must refuse them. */
  nonAdmin: boolean
  /** The code the OTP endpoints accept. */
  otpCode: string
}

const defaultScenario = (): Scenario => ({
  operationFailures: {},
  nonAdmin: false,
  otpCode: '123456',
})

export interface AuthRequest {
  redirectUri: string
  state: string
  nonce: string | null
}

export interface OtpSession {
  id: string
  token: string
  loginName: string
  verified: boolean
}

/** What the fake Zitadel and the OTP endpoints keep between two calls. */
export class AuthState {
  requests = new Map<string, AuthRequest>()
  codes = new Map<string, AuthRequest>()
  sessions = new Map<string, OtpSession>()
  refreshTokens = new Set<string>()
  private counter = 0

  next(prefix: string): string {
    this.counter += 1
    return `${prefix}-${this.counter}`
  }

  startRequest(params: URLSearchParams): string {
    const id = this.next('authreq')
    this.requests.set(id, {
      redirectUri: params.get('redirect_uri') ?? '',
      state: params.get('state') ?? '',
      nonce: params.get('nonce'),
    })
    return id
  }
}

const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString()

const translation = (name: string, zh?: string) => [
  { language: 'fr', name },
  ...(zh === undefined ? [] : [{ language: 'zh', name: zh }]),
]

const category = (id: string, name: string, order: number) => ({
  id,
  name,
  order,
  slug: name.toLowerCase(),
  translations: [{ language: 'fr', name, description: null }],
})

export const CATEGORIES = [
  category('cat-sushi', 'Sushi', 1),
  category('cat-boissons', 'Boissons', 2),
]

export interface ProductSeed {
  id: string
  name: string
  price: string
  code: string | null
  categoryId: string
  isAvailable?: boolean
}

export const PRODUCT_SEEDS: ProductSeed[] = [
  { id: 'prod-saumon', name: 'Sushi saumon', price: '4.50', code: 'S1', categoryId: 'cat-sushi' },
  { id: 'prod-thon', name: 'Sushi thon', price: '5.00', code: 'S2', categoryId: 'cat-sushi' },
  { id: 'prod-cola', name: 'Cola', price: '2.50', code: 'B1', categoryId: 'cat-boissons' },
]

export function productOf(seed: ProductSeed): Json {
  const found = CATEGORIES.find((c) => c.id === seed.categoryId)
  return {
    id: seed.id,
    categoryId: seed.categoryId,
    price: seed.price,
    code: seed.code,
    slug: seed.name.toLowerCase().replace(/\s+/gu, '-'),
    pieceCount: 2,
    isVisible: true,
    isAvailable: seed.isAvailable ?? true,
    isHalal: false,
    isLunchOnly: false,
    isSpicy: false,
    isVegetarian: false,
    isDiscountable: true,
    vatCategory: 'food',
    name: seed.name,
    description: null,
    category: found ?? CATEGORIES[0],
    choices: [],
    choiceGroups: [],
    translations: [{ language: 'fr', name: seed.name, description: null }],
  }
}

export interface OrderSeed {
  id: string
  status: string
  type: 'PICKUP' | 'DELIVERY'
  customer: string
  minutesAgo: number
  online?: boolean
  paid?: boolean
  lines: { product: string; quantity: number }[]
  address?: string
  note?: string
  estimatedReadyMinutes?: number
}

export function orderOf(seed: OrderSeed): Json {
  const products = PRODUCT_SEEDS.map(productOf)
  const items = seed.lines.map((line) => {
    const product = products.find((p) => p.id === line.product) ?? products[0]!
    const unit = Number(product.price)
    return {
      unitPrice: unit.toFixed(2),
      quantity: line.quantity,
      totalPrice: (unit * line.quantity).toFixed(2),
      product: { ...product, translations: translation(String(product.name), '三文鱼寿司') },
      choice: null,
    }
  })
  const total = items.reduce((sum, item) => sum + Number(item.totalPrice), 0)
  const [first = 'Client', ...rest] = seed.customer.split(' ')
  const address =
    seed.type === 'DELIVERY'
      ? {
          id: `addr-${seed.id}`,
          streetName: 'Rue Saint-Gilles',
          houseNumber: '12',
          boxNumber: null,
          municipalityName: 'Liège',
          postcode: '4000',
          distance: 1.8,
        }
      : null
  return {
    id: seed.id,
    createdAt: minutesAgo(seed.minutesAgo),
    updatedAt: minutesAgo(seed.minutesAgo),
    status: seed.status,
    type: seed.type,
    isOnlinePayment: seed.online ?? false,
    couponCode: null,
    discountAmount: '0.00',
    deliveryFee: seed.type === 'DELIVERY' ? '2.50' : null,
    totalPrice: (total + (seed.type === 'DELIVERY' ? 2.5 : 0)).toFixed(2),
    preferredReadyTime: null,
    estimatedReadyTime:
      seed.estimatedReadyMinutes === undefined
        ? null
        : new Date(Date.now() + seed.estimatedReadyMinutes * 60_000).toISOString(),
    addressExtra: null,
    orderNote: seed.note ?? null,
    orderExtra: null,
    isManualAddress: false,
    displayCustomerName: seed.customer,
    displayAddress: seed.address ?? (address ? 'Rue Saint-Gilles 12, 4000 Liège' : ''),
    address,
    customer: {
      id: `cust-${seed.id}`,
      firstName: first,
      lastName: rest.join(' '),
      phoneNumber: '+32470123456',
    },
    payment: { status: seed.paid === true ? 'paid' : 'open' },
    items,
  }
}

/** The orders every test starts with: one per kanban column that the specs act on. */
export const DEFAULT_ORDERS: OrderSeed[] = [
  {
    id: 'order-pending',
    status: 'PENDING',
    type: 'PICKUP',
    customer: 'Alice Martin',
    minutesAgo: 3,
    lines: [{ product: 'prod-saumon', quantity: 4 }],
  },
  {
    id: 'order-confirmed',
    status: 'CONFIRMED',
    type: 'DELIVERY',
    customer: 'Bob Dupont',
    minutesAgo: 9,
    online: true,
    paid: true,
    lines: [
      { product: 'prod-thon', quantity: 2 },
      { product: 'prod-cola', quantity: 2 },
    ],
  },
  {
    id: 'order-preparing',
    status: 'PREPARING',
    type: 'PICKUP',
    customer: 'Chloe Lambert',
    minutesAgo: 14,
    online: true,
    paid: true,
    estimatedReadyMinutes: 10,
    lines: [{ product: 'prod-thon', quantity: 3 }],
  },
  {
    id: 'order-ready',
    status: 'AWAITING_PICK_UP',
    type: 'PICKUP',
    customer: 'David Renard',
    minutesAgo: 22,
    paid: true,
    lines: [{ product: 'prod-saumon', quantity: 2 }],
  },
]

export const DEFAULT_COUPONS: Json[] = [
  {
    id: 'coupon-welcome',
    code: 'WELCOME10',
    discountType: 'PERCENTAGE',
    discountValue: '10.00',
    minOrderAmount: null,
    maxUses: null,
    maxUsesPerUser: 1,
    usedCount: 3,
    isActive: true,
    appOnly: false,
    status: 'ACTIVE',
    validFrom: null,
    validUntil: null,
    createdAt: minutesAgo(60 * 24 * 7),
  },
]

type Listener = (event: unknown) => void

export class MockState {
  scenario: Scenario = defaultScenario()
  auth = new AuthState()
  orders = new Map<string, Json>()
  products = new Map<string, Json>()
  coupons = new Map<string, Json>()
  orderingEnabled = true
  operations: OperationLog[] = []
  restCalls: RestLog[] = []
  gaps: string[] = []
  private readonly listeners = new Map<string, Set<Listener>>()
  private counter = 0

  constructor() {
    this.reset()
  }

  reset(): void {
    this.scenario = defaultScenario()
    this.auth = new AuthState()
    this.orders = new Map(DEFAULT_ORDERS.map((seed) => [seed.id, orderOf(seed)]))
    this.products = new Map(PRODUCT_SEEDS.map((seed) => [seed.id, productOf(seed)]))
    this.coupons = new Map(DEFAULT_COUPONS.map((coupon) => [String(coupon.id), { ...coupon }]))
    this.orderingEnabled = true
    this.operations = []
    this.restCalls = []
    this.gaps = []
    this.counter = 0
  }

  nextId(prefix: string): string {
    this.counter += 1
    return `${prefix}-${this.counter}`
  }

  log(entry: OperationLog): void {
    this.operations.push(entry)
  }

  noteGap(gap: string): void {
    if (!this.gaps.includes(gap)) this.gaps.push(gap)
  }

  subscribe(topic: string, listener: Listener): () => void {
    const set = this.listeners.get(topic) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(topic, set)
    return () => {
      set.delete(listener)
    }
  }

  publish(topic: string, event: unknown): void {
    for (const listener of this.listeners.get(topic) ?? []) listener(event)
  }

  /** Topics somebody is subscribed to: a push only reaches a page once it has subscribed. */
  subscriptions(): string[] {
    return [...this.listeners.entries()].filter(([, set]) => set.size > 0).map(([topic]) => topic)
  }
}

import { GraphQLFailure, type Operations, type RequestContext } from './graphql.ts'
import { type Json, productOf } from './state.ts'

/*
 * One resolver per root query / mutation / subscription the dashboard uses. Input is validated only as far as the
 * dashboard relies on it (an order moves along the allowed statuses, a product keeps what the input does not touch).
 */

/** Same table as `getAllowedStatuses` in utils/orders.ts, kept apart on purpose: the mock is the server's opinion. */
function allowedNext(status: string, type: string): string[] {
  switch (status) {
    case 'PENDING':
      return ['CONFIRMED', 'PREPARING', 'CANCELLED']
    case 'CONFIRMED':
      return ['PREPARING', 'CANCELLED']
    case 'PREPARING':
      return ['AWAITING_PICK_UP', 'CANCELLED']
    case 'AWAITING_PICK_UP':
      return type === 'DELIVERY'
        ? ['OUT_FOR_DELIVERY', 'CANCELLED']
        : ['PICKED_UP', 'FAILED', 'CANCELLED']
    case 'OUT_FOR_DELIVERY':
      return ['DELIVERED', 'FAILED', 'CANCELLED']
    default:
      return []
  }
}

const record = (value: unknown): Json =>
  value !== null && typeof value === 'object' ? (value as Json) : {}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

function requireOrder({ state }: RequestContext, id: unknown): Json {
  const order = state.orders.get(text(id))
  if (!order) throw new GraphQLFailure('NOT_FOUND', 'order not found')
  return order
}

function requireProduct({ state }: RequestContext, id: unknown): Json {
  const product = state.products.get(text(id))
  if (!product) throw new GraphQLFailure('NOT_FOUND', 'product not found')
  return product
}

/** The dashboard sends `categoryID` (sic) on update and `categoryId` on create. */
function productFields(input: Json): Json {
  const { categoryID, categoryId, translations, image, removeBackground, ...rest } = input
  void image
  void removeBackground
  const fields: Json = { ...rest }
  const category = text(categoryID ?? categoryId)
  if (category !== '') fields.categoryId = category
  if (Array.isArray(translations)) {
    fields.translations = translations.map((tr) => ({
      language: text(record(tr).language),
      name: text(record(tr).name),
      description: record(tr).description ?? null,
    }))
    const fr = (fields.translations as Json[]).find((tr) => tr.language === 'fr')
    if (fr) fields.name = fr.name
  }
  return fields
}

export const operations: Operations = {
  queries: {
    me: ({ state }) => ({
      id: 'user-admin',
      email: 'staff@example.test',
      firstName: 'Eva',
      lastName: 'Staff',
      phoneNumber: null,
      isAdmin: !state.scenario.nonAdmin,
      address: null,
    }),
    orders: ({ state }) =>
      [...state.orders.values()].toSorted((a, b) =>
        text(b.createdAt).localeCompare(text(a.createdAt)),
      ),
    order: (context, args) => requireOrder(context, args.id),
    products: ({ state }) => [...state.products.values()],
    productCategories: ({ state }) => [
      ...new Map(
        [...state.products.values()].map((p) => [text(record(p.category).id), p.category]),
      ).values(),
    ],
    coupons: ({ state }) => [...state.coupons.values()],
    restaurantConfig: ({ state }) => ({ orderingEnabled: state.orderingEnabled }),
    assistantConnection: () => ({
      enabled: false,
      state: 'UNAVAILABLE',
      botUsername: null,
      accounts: [],
      maxAccounts: 3,
      problemSince: null,
    }),
  },

  mutations: {
    updateOrder: (context, args) => {
      const { state } = context
      const order = requireOrder(context, args.id)
      const input = record(args.input)
      const target = text(input.status)
      if (target !== '' && target !== order.status) {
        if (!allowedNext(text(order.status), text(order.type)).includes(target)) {
          throw new GraphQLFailure(
            'INVALID_STATUS_TRANSITION',
            `cannot go from ${text(order.status)} to ${target}`,
          )
        }
        order.status = target
      }
      if (typeof input.estimatedReadyTime === 'string') {
        order.estimatedReadyTime = input.estimatedReadyTime
      }
      order.updatedAt = new Date().toISOString()
      state.publish('orderUpdated', order)
      return order
    },
    updatePaymentStatus: (context, args) => {
      const { state } = context
      const order = requireOrder(context, args.orderId)
      order.payment = { status: text(args.status) }
      order.updatedAt = new Date().toISOString()
      state.publish('orderUpdated', order)
      return { id: order.id, status: text(args.status) }
    },
    updateOrderingEnabled: ({ state }, args) => {
      state.orderingEnabled = args.enabled === true
      state.publish('restaurantConfigUpdated', { orderingEnabled: state.orderingEnabled })
      return { orderingEnabled: state.orderingEnabled }
    },
    createProduct: ({ state }, args) => {
      const id = state.nextId('prod-new')
      const product = {
        ...productOf({ id, name: 'Nouveau', price: '0', code: null, categoryId: 'cat-sushi' }),
        ...productFields(record(args.input)),
      }
      const category = [...state.products.values()]
        .map((p) => record(p.category))
        .find((c) => c.id === product.categoryId)
      if (category) product.category = category
      state.products.set(id, product)
      state.publish('productUpdated', product)
      return product
    },
    updateProduct: (context, args) => {
      const { state } = context
      const product = requireProduct(context, args.id)
      Object.assign(product, productFields(record(args.input)))
      state.publish('productUpdated', product)
      return product
    },
    createCoupon: ({ state }, args) => {
      const input = record(args.input)
      const code = text(input.code).toUpperCase()
      if ([...state.coupons.values()].some((c) => c.code === code)) {
        throw new GraphQLFailure('COUPON_CODE_TAKEN', 'code already used')
      }
      const id = state.nextId('coupon-new')
      const coupon: Json = {
        usedCount: 0,
        maxUses: null,
        maxUsesPerUser: null,
        minOrderAmount: null,
        validFrom: null,
        validUntil: null,
        appOnly: false,
        ...input,
        id,
        code,
        status: input.isActive === false ? 'INACTIVE' : 'ACTIVE',
        createdAt: new Date().toISOString(),
      }
      state.coupons.set(id, coupon)
      state.publish('couponUpdated', coupon)
      return coupon
    },
    updateCoupon: (context, args) => {
      const { state } = context
      const coupon = state.coupons.get(text(args.id))
      if (!coupon) throw new GraphQLFailure('NOT_FOUND', 'coupon not found')
      Object.assign(coupon, record(args.input))
      coupon.status = coupon.isActive === false ? 'INACTIVE' : 'ACTIVE'
      state.publish('couponUpdated', coupon)
      return coupon
    },
  },

  // The topic of an event is the name of the subscription field.
  subscriptions: {
    orderUpdated: { payload: (event) => event },
    orderCreated: { payload: (event) => event },
    restaurantConfigUpdated: { payload: (event) => event },
    productUpdated: { payload: (event) => event },
    couponUpdated: { payload: (event) => event },
    assistantConnectionUpdated: { payload: (event) => event },
  },
}

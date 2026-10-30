import type { HubriseOrderInfo, HubriseProductFields } from '~/utils/hubrise'
// Types/index.ts
export interface Translation {
  language: string
  name: string
  description: string | null
}

export interface ChoiceTranslation {
  locale: string
  name: string
}

export interface ProductChoice {
  id: string
  productId: string
  choiceGroupId?: string
  priceModifier: string
  sortOrder: number
  name: string
  translations: ChoiceTranslation[]
}

export interface ProductChoiceGroup {
  id: string
  productId: string
  minSelections: number
  maxSelections: number
  sortOrder: number
  name: string
  translations: ChoiceTranslation[]
  choices: ProductChoice[]
}

export interface ChoiceTranslationInput {
  locale: string
  name: string
}

export interface CreateProductChoiceInput {
  productId: string
  priceModifier: string
  sortOrder: number
  translations: ChoiceTranslationInput[]
}

export interface UpdateProductChoiceInput {
  priceModifier?: string
  sortOrder?: number
  translations?: ChoiceTranslationInput[]
}

export type VatCategory = 'food' | 'beverage' | 'zero_rated' | 'out_of_scope'

export interface Product extends HubriseProductFields {
  categoryId: string
  code: string | null
  id: string
  isAvailable: boolean
  isDiscountable: boolean
  isHalal: boolean
  isLunchOnly: boolean
  isSpicy: boolean
  isVegetarian: boolean
  isVisible: boolean
  pieceCount: number | null
  price: string
  slug: string
  vatCategory: VatCategory

  name: string
  description: string | null

  category: ProductCategory
  choices: ProductChoice[]
  choiceGroups?: ProductChoiceGroup[]

  translations: Translation[]
}

export interface ProductCategory {
  id: string
  name: string
  order: number
  slug: string

  translations: Translation[]
}

export interface CreateProductInput {
  categoryId: string
  code?: string
  isAvailable: boolean
  isDiscountable: boolean
  isHalal: boolean
  isLunchOnly: boolean
  isSpicy: boolean
  isVegetarian: boolean
  isVisible: boolean
  pieceCount?: number
  price: string
  vatCategory: VatCategory

  translations: TranslationInput[]

  image?: File
  removeBackground?: boolean
}

export interface UpdateProductInput {
  categoryID?: string
  code?: string | null
  isAvailable?: boolean
  isDiscountable?: boolean
  isHalal?: boolean
  isLunchOnly?: boolean
  isSpicy?: boolean
  isVegetarian?: boolean
  isVisible?: boolean
  pieceCount?: number | null
  price?: string
  vatCategory?: VatCategory

  translations?: TranslationInput[]

  image?: File
  removeBackground?: boolean
}

export interface UpdateProductRequest {
  id: string
  input: UpdateProductInput
}

export interface TranslationInput {
  description?: string
  language: string
  name: string
}

export type CouponStatus = 'ACTIVE' | 'INACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'EXHAUSTED'

export interface Coupon {
  id: string
  code: string
  discountType: string
  discountValue: string
  minOrderAmount: string | null
  maxUses: number | null
  maxUsesPerUser: number | null
  usedCount: number
  isActive: boolean
  /** Only the iOS/Android app can redeem it: the website refuses it. */
  appOnly: boolean
  status: CouponStatus
  validFrom: string | null
  validUntil: string | null
  createdAt: string
}

export interface CreateCouponInput {
  code: string
  discountType: string
  discountValue: string
  minOrderAmount?: string | null
  maxUses?: number | null
  maxUsesPerUser?: number | null
  isActive: boolean
  appOnly?: boolean
  validFrom?: string | null
  validUntil?: string | null
}

export interface UpdateCouponInput {
  code?: string
  discountType?: string
  discountValue?: string
  minOrderAmount?: string | null
  maxUses?: number | null
  maxUsesPerUser?: number | null
  isActive?: boolean
  appOnly?: boolean
  validFrom?: string | null
  validUntil?: string | null
}

export interface User {
  email: string
  firstName: string
  id: string
  isAdmin: boolean
  lastName: string
  phoneNumber: string | null

  address: Address | null
}

export interface Customer {
  id: string
  firstName: string
  lastName: string
  phoneNumber: string | null
}

export type OrderStatus = OrderDeliveryStatus | OrderPickUpStatus

export type OrderDeliveryStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'AWAITING_PICK_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED'
export type OrderPickUpStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'AWAITING_PICK_UP'
  | 'PICKED_UP'
  | 'CANCELLED'
  | 'FAILED'
export type OrderType = 'DELIVERY' | 'PICKUP'
export interface Order {
  /** The HubRise side of the order; null when it never reached HubRise, absent where the server has none. */
  hubrise?: HubriseOrderInfo | null
  addressExtra: string | null
  addressId: string | null
  createdAt: string
  deliveryFee: string | null
  couponCode: string | null
  discountAmount: string
  preferredReadyTime: string | null
  estimatedReadyTime: string | null
  id: string
  isOnlinePayment: boolean
  orderExtra: { name: string | null; options: string[] | null }[] | null
  orderNote: string | null
  paymentID: string | null
  status: OrderStatus
  totalPrice: string
  type: OrderType
  updatedAt: string
  userId: string

  isManualAddress: boolean

  // Computed helper fields
  displayCustomerName: string
  displayAddress: string

  address: Address | null
  customer: Customer | null
  items: OrderProduct[]
  payment: MolliePayment | null
}

export interface OrderProduct {
  quantity: number
  totalPrice: string
  unitPrice: string

  product: Product
  choice: ProductChoice | null
}

export interface MolliePayment {
  createdAt: string
  id: string
  links: object
  orderId: string
  paidAt: string | null
  status: string
}

export interface Address {
  id: string
  streetName: string
  houseNumber: string
  boxNumber: string | null
  municipalityName: string
  postcode: string
  distance: number
}

// --- Customer Statistics Types ---

export interface CustomerStats {
  userId: string
  firstName: string
  lastName: string
  email: string
  phoneNumber: string | null
  registeredAt: string
  totalOrders: number
  totalAmount: string
  averageOrderAmount: string
  firstOrderDate: string
  lastOrderDate: string
  preferredOrderType: OrderType
  deliveryCount: number
  pickupCount: number
}

export interface CustomerStatsSummary {
  totalCustomers: number
  totalRevenue: string
  averageOrderValue: string
  totalOrders: number
}

export interface CustomerStatsResponse {
  summary: CustomerStatsSummary
  customers: CustomerStats[]
}

export interface CustomerStatsInput {
  startDate?: string
  endDate?: string
  orderType?: OrderType
  minOrders?: number
}

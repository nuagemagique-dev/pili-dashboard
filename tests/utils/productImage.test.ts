import { describe, expect, it } from 'vite-plus/test'

import { productThumbnailUrl } from '~/utils/productImage'

const BUCKET = 'https://cdn.example'
const ID = '9e199419-97b6-49b7-8b04-afe46ac919a3'

describe('productThumbnailUrl', () => {
  it('versions the URL with the image update time', () => {
    expect(productThumbnailUrl(BUCKET, { id: ID, imageUpdatedAt: '2026-11-27T10:07:16Z' })).toBe(
      `${BUCKET}/images/thumbnails/${ID}.png?v=1795774036000`,
    )
  })

  it('changes the URL when the image changes', () => {
    const before = productThumbnailUrl(BUCKET, { id: ID, imageUpdatedAt: '2026-11-27T10:07:16Z' })
    const after = productThumbnailUrl(BUCKET, { id: ID, imageUpdatedAt: '2026-11-27T10:07:17Z' })
    expect(after).not.toBe(before)
  })

  it('leaves the URL bare without a usable version', () => {
    const bare = `${BUCKET}/images/thumbnails/${ID}.png`
    expect(productThumbnailUrl(BUCKET, { id: ID })).toBe(bare)
    expect(productThumbnailUrl(BUCKET, { id: ID, imageUpdatedAt: null })).toBe(bare)
    expect(productThumbnailUrl(BUCKET, { id: ID, imageUpdatedAt: 'not a date' })).toBe(bare)
  })

  it('returns null without a bucket or a product id', () => {
    expect(productThumbnailUrl(undefined, { id: ID })).toBeNull()
    expect(productThumbnailUrl('', { id: ID })).toBeNull()
    expect(productThumbnailUrl(BUCKET, { id: '' })).toBeNull()
    expect(productThumbnailUrl(BUCKET, null)).toBeNull()
    expect(productThumbnailUrl(BUCKET, undefined)).toBeNull()
  })
})

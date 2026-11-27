/**
 * Thumbnail URL of a product image. A new upload replaces the file under the same key, so the
 * URL carries the image version (`imageUpdatedAt`) to get past browser and CDN caches.
 */
export function productThumbnailUrl(
  bucketUrl: string | undefined,
  product: { id?: string | null; imageUpdatedAt?: string | null } | null | undefined,
): string | null {
  const id = product?.id
  if (bucketUrl === undefined || bucketUrl === '' || id === undefined || id === null || id === '') {
    return null
  }
  const url = `${bucketUrl}/images/thumbnails/${id}.png`
  const updatedAt = product?.imageUpdatedAt
  const version = typeof updatedAt === 'string' ? Date.parse(updatedAt) : Number.NaN
  return Number.isNaN(version) ? url : `${url}?v=${version}`
}

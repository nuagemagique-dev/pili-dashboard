<template>
  <PiliChip v-if="chip" :tone="chip.tone" size="sm" :data-hubrise-chip="kind">{{
    t(chip.key)
  }}</PiliChip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { type HubriseProductFields, isHubriseManaged, publishChip } from '~/utils/hubrise'

const { product } = defineProps<{ product: HubriseProductFields }>()

const { t } = useI18n()

// HubRise owns the product (IMPORT), or the dashboard publishes it (PUBLISH); a product is never both.
const kind = computed(() => (isHubriseManaged(product) ? 'managed' : 'publish'))
const chip = computed(() =>
  isHubriseManaged(product)
    ? ({ tone: 'info', key: 'products.hubrise.managed' } as const)
    : publishChip(product.hubrisePublish),
)
</script>

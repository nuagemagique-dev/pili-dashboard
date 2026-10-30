<template>
  <div class="flex flex-col gap-3" data-testid="hubrise-platform-prices">
    <div>
      <p class="text-sm font-bold">{{ t('hubrise.platformPrices.title') }}</p>
      <p class="text-[13px] text-muted leading-snug">
        {{ t('hubrise.platformPrices.description') }}
      </p>
    </div>
    <div
      v-for="(row, index) in rows"
      :key="index"
      class="grid grid-cols-2 gap-2 p-3 rounded-[14px] border border-default"
    >
      <UFormField :label="t('hubrise.platformPrices.name')">
        <UInput v-model="row.name" class="w-full" />
      </UFormField>
      <UFormField :label="t('hubrise.platformPrices.variantRef')">
        <UInput v-model="row.variantRef" class="w-full" />
      </UFormField>
      <UFormField :label="t('hubrise.platformPrices.markupPercent')">
        <UInput v-model.number="row.markupPercent" type="number" min="0" max="100" class="w-full" />
      </UFormField>
      <UFormField :label="t('hubrise.platformPrices.roundToCents')">
        <UInput v-model.number="row.roundToCents" type="number" min="1" max="100" class="w-full" />
      </UFormField>
      <UButton
        class="col-span-2"
        :label="t('hubrise.platformPrices.remove')"
        icon="i-lucide-trash-2"
        color="neutral"
        variant="ghost"
        block
        @click="rows.splice(index, 1)"
      />
    </div>
    <UButton
      :label="t('hubrise.platformPrices.add')"
      icon="i-lucide-plus"
      color="neutral"
      variant="soft"
      block
      @click="rows.push(newPlatformPrice())"
    />
    <UButton
      v-if="dirty"
      :label="t('common.save')"
      icon="i-lucide-save"
      :loading="busy"
      block
      @click="emit('save', cleanPlatformPrices(rows))"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  type HubrisePlatformPrice,
  cleanPlatformPrices,
  newPlatformPrice,
  platformPricesChanged,
} from '~/utils/hubrise'

const { stored, busy } = defineProps<{ stored: readonly HubrisePlatformPrice[]; busy: boolean }>()
const emit = defineEmits<{ save: [prices: HubrisePlatformPrice[]] }>()
const { t } = useI18n()

const rows = ref<HubrisePlatformPrice[]>([])
// The rows follow the server until the admin edits them.
watch(
  () => stored,
  (next, previous) => {
    if (previous === undefined || !platformPricesChanged(previous, rows.value)) {
      rows.value = next.map((price) => ({ ...price }))
    }
  },
  { immediate: true },
)
const dirty = computed(() => platformPricesChanged(stored, rows.value))
</script>

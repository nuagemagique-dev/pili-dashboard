<template>
  <span v-if="badges.length" class="inline-flex items-center gap-1.5 flex-wrap">
    <PiliChip
      v-for="badge in badges"
      :key="badge.id"
      :tone="badge.tone"
      size="sm"
      :data-hubrise-badge="badge.id"
      >{{ t(badge.key) }}</PiliChip
    >
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { type HubriseOrderInfo, orderHubriseBadges } from '~/utils/hubrise'

const { info = null } = defineProps<{ info?: HubriseOrderInfo | null }>()

const { t } = useI18n()
const badges = computed(() => orderHubriseBadges(info))
</script>

<template>
  <NuxtLink
    v-if="kind"
    :to="localePath('/hubrise')"
    role="alert"
    class="mx-4 mt-3 md:mx-0 md:mt-0 px-4 py-3 rounded-[14px] bg-error text-inverted flex items-center gap-3"
  >
    <UIcon name="i-lucide-plug-zap" class="size-5 shrink-0" />
    <span class="flex-1 min-w-0 text-sm font-bold leading-snug">{{
      t(`hubrise.layoutBanner.${kind}`, { count: parked }, parked)
    }}</span>
    <span class="text-sm font-bold underline shrink-0">{{ t('hubrise.layoutBanner.action') }}</span>
  </NuxtLink>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { layoutBanner } from '~/utils/hubrise'

const { t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const { status } = useHubriseStatus()

const kind = computed(() => layoutBanner(status.value, route.path))
const parked = computed(() => status.value?.backlog.parked ?? 0)
</script>

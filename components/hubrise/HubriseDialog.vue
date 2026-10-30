<template>
  <!-- Dialog from md, bottom sheet on phones (like the coupon form) -->
  <PiliBottomSheet
    v-if="isMobile"
    :open="open"
    :title="title"
    :description="description"
    full
    @update:open="emit('update:open', $event)"
  >
    <slot />
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </PiliBottomSheet>
  <UModal
    v-else
    :open="open"
    :title="title"
    :description="description ?? title"
    :ui="{ content: 'max-w-2xl' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <slot />
      </div>
    </template>
    <template v-if="$slots.footer" #footer>
      <div class="w-full flex justify-end gap-2">
        <slot name="footer" />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import PiliBottomSheet from '~/components/pili/PiliBottomSheet.vue'

const {
  open,
  title,
  description = undefined,
} = defineProps<{
  open: boolean
  title: string
  description?: string
}>()

const emit = defineEmits<{ 'update:open': [open: boolean] }>()

const isMobile = useIsMobile()
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="hubrise-direction">
    <p class="text-[13px] sm:text-sm text-muted leading-snug">{{ t('hubrise.direction.intro') }}</p>

    <div
      class="grid gap-2 md:grid-cols-3"
      role="radiogroup"
      :aria-label="t('hubrise.direction.title')"
    >
      <button
        v-for="direction in CATALOG_DIRECTIONS"
        :key="direction"
        type="button"
        role="radio"
        :aria-checked="status.catalogDirection === direction"
        :data-direction="direction"
        class="p-3.5 rounded-[14px] border text-left flex flex-col gap-1 cursor-pointer"
        :class="
          status.catalogDirection === direction
            ? 'bg-accented border-inverted'
            : 'bg-elevated border-default active:bg-accented'
        "
        @click="choose(direction)"
      >
        <span class="flex items-center gap-2">
          <span class="text-base font-bold">{{
            t(`hubrise.direction.options.${direction}.title`)
          }}</span>
          <PiliChip v-if="status.catalogDirection === direction" tone="success" size="sm">{{
            t('hubrise.direction.current')
          }}</PiliChip>
        </span>
        <span class="text-[13px] text-muted leading-snug">{{
          t(`hubrise.direction.options.${direction}.description`)
        }}</span>
      </button>
    </div>

    <div
      v-if="notice"
      role="status"
      class="px-3 py-2.5 rounded-[10px] bg-accented text-sm flex items-center gap-3 flex-wrap"
    >
      <span class="flex-1 min-w-0">{{ t(`hubrise.direction.blocked.${notice}`) }}</span>
      <UButton
        v-if="notice === 'reconnectRequired'"
        :label="t('hubrise.actions.reconnect')"
        size="sm"
        @click="emit('reconnect')"
      />
    </div>

    <HubriseDialog
      :open="target !== null"
      :title="t('hubrise.direction.dialogTitle')"
      @update:open="(value) => !value && close()"
    >
      <template v-if="plan">
        <p class="text-sm leading-snug">{{ plan.confirmKey ? t(plan.confirmKey) : '' }}</p>

        <UCheckbox
          v-if="needsAck"
          v-model="acknowledged"
          :label="t('hubrise.direction.acknowledgeOverwrite')"
        />

        <template v-if="plan.needsImportPreview">
          <p v-if="catalog.busy.value" class="text-sm text-muted">
            {{ t('hubrise.import.loading') }}
          </p>
          <ImportDiff v-else-if="catalog.diff.value" :diff="catalog.diff.value" />
          <p v-if="catalog.error.value" role="alert" class="text-sm text-error font-bold">
            {{ t(catalog.error.value.key, catalog.error.value.params) }}
          </p>
        </template>

        <p v-if="publish.error.value" role="alert" class="text-sm text-error font-bold">
          {{ t(publish.error.value.key, publish.error.value.params) }}
        </p>
      </template>
      <template #footer>
        <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="close" />
        <UButton
          :label="t('hubrise.direction.confirmButton')"
          :loading="publish.switching.value"
          :disabled="!canConfirm"
          @click="confirm"
        />
      </template>
    </HubriseDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import HubriseDialog from '~/components/hubrise/HubriseDialog.vue'
import ImportDiff from '~/components/hubrise/ImportDiff.vue'
import {
  CATALOG_DIRECTIONS,
  type DirectionBlock,
  type HubriseCatalogDirection,
  type HubriseStatus,
  planDirectionChange,
} from '~/utils/hubrise'

const { status } = defineProps<{ status: HubriseStatus }>()

const emit = defineEmits<{ reconnect: []; changed: [direction: HubriseCatalogDirection] }>()

const { t } = useI18n()
const toast = useToast()
const publish = useHubrisePublish()
const catalog = useHubriseCatalog()

const target = ref<HubriseCatalogDirection | null>(null)
const acknowledged = ref(false)
/** The server asked for the acknowledgement although the status did not show unpublished edits. */
const serverWantsAck = ref(false)
const notice = ref<DirectionBlock | null>(null)

const plan = computed(() =>
  target.value === null ? null : planDirectionChange(status, target.value),
)
const needsAck = computed(() => plan.value?.needsLocalOverwriteAck === true || serverWantsAck.value)
const importReady = computed(
  () => plan.value?.needsImportPreview !== true || catalog.diff.value !== null,
)
const canConfirm = computed(
  () =>
    plan.value?.allowed === true &&
    importReady.value &&
    (!needsAck.value || acknowledged.value) &&
    !publish.switching.value &&
    !catalog.busy.value,
)

const close = () => {
  target.value = null
  acknowledged.value = false
  serverWantsAck.value = false
  publish.reset()
  catalog.reset()
}

const choose = async (direction: HubriseCatalogDirection) => {
  const next = planDirectionChange(status, direction)
  notice.value = next.blocked === 'sameDirection' ? null : next.blocked
  if (!next.allowed) return
  target.value = direction
  // Switching to IMPORT starts with the dry run: the diff is what the admin confirms.
  if (next.needsImportPreview) await catalog.preview('DRY_RUN')
}

const confirm = async () => {
  const direction = target.value
  if (direction === null) return
  const result = await publish.setDirection(direction, acknowledged.value)
  if (result !== null) {
    toast.add({ title: t('hubrise.direction.changed'), color: 'success' })
    close()
    emit('changed', direction)
    return
  }
  const code = publish.error.value?.code
  if (code === 'HUBRISE_PUBLISH_PENDING_CHANGES') serverWantsAck.value = true
  else if (code === 'HUBRISE_PREVIEW_REQUIRED') {
    await catalog.preview('DRY_RUN')
    publish.reset()
  }
}
</script>

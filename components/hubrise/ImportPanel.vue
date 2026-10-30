<template>
  <div class="flex flex-col gap-3" data-testid="hubrise-import">
    <p class="text-[13px] sm:text-sm text-muted leading-snug">
      {{ t(`hubrise.import.intro.${status.catalogDirection}`) }}
    </p>

    <div v-if="modes.length > 1" class="flex flex-wrap gap-2" role="radiogroup">
      <button
        v-for="candidate in modes"
        :key="candidate"
        type="button"
        role="radio"
        :aria-checked="mode === candidate"
        class="px-3 min-h-11 rounded-xl border text-sm font-bold"
        :class="mode === candidate ? 'bg-accented border-default' : 'border-default text-muted'"
        @click="chooseMode(candidate)"
      >
        {{ t(`hubrise.import.modes.${candidate}`) }}
      </button>
    </div>
    <p class="text-xs text-muted leading-snug">{{ t(`hubrise.import.modeHint.${mode}`) }}</p>

    <div class="flex flex-wrap gap-2">
      <UButton
        :label="t('hubrise.import.preview')"
        icon="i-lucide-scan-search"
        color="neutral"
        variant="outline"
        :loading="catalog.busy.value && !applying"
        :disabled="catalog.busy.value || !status.enabled"
        @click="preview"
      />
      <UButton
        v-if="catalog.diff.value"
        :label="t(`hubrise.import.apply.${mode}`)"
        icon="i-lucide-download"
        :loading="applying"
        :disabled="catalog.busy.value || (needsConfirm && !confirmRetire)"
        @click="apply"
      />
    </div>
    <p v-if="!status.enabled" class="text-xs text-muted">{{ t('hubrise.import.enableFirst') }}</p>

    <p v-if="catalog.error.value" role="alert" class="text-sm text-error font-bold">
      {{ t(catalog.error.value.key, catalog.error.value.params) }}
    </p>

    <template v-if="catalog.diff.value">
      <ImportDiff :diff="catalog.diff.value" />
      <UCheckbox
        v-if="needsConfirm"
        v-model="confirmRetire"
        color="error"
        :label="t('hubrise.import.confirmRetire', { count: catalog.diff.value.retiringProducts })"
      />
    </template>

    <div v-if="catalog.result.value" class="text-sm flex flex-col gap-1" role="status">
      <span class="font-bold">{{
        catalog.result.value.applied
          ? t('hubrise.import.applied')
          : catalog.result.value.pendingReview
            ? t('hubrise.import.waitingReview')
            : t('hubrise.import.notApplied')
      }}</span>
      <span v-if="catalog.result.value.failedBatches.length" class="text-error">{{
        t('hubrise.import.failedBatches', {
          batches: catalog.result.value.failedBatches.join(', '),
        })
      }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ImportDiff from '~/components/hubrise/ImportDiff.vue'
import { type HubriseStatus, type HubriseSyncMode, importModes } from '~/utils/hubrise'

const { status } = defineProps<{ status: HubriseStatus }>()

const emit = defineEmits<{ applied: [] }>()

const { t } = useI18n()
const toast = useToast()
const catalog = useHubriseCatalog()

const modes = computed(() => importModes(status.catalogDirection))
const mode = ref<HubriseSyncMode>(modes.value[0] ?? 'LINK_ONLY')
const confirmRetire = ref(false)
const applying = ref(false)

// The mode on offer changes with the owner of the menu (PUBLISH only adopts).
watch(modes, (list) => {
  if (!list.includes(mode.value)) mode.value = list[0] ?? 'LINK_ONLY'
})

const needsConfirm = computed(
  () =>
    mode.value === 'FULL' &&
    (catalog.diff.value?.retireNeedsConfirm === true ||
      catalog.error.value?.code === 'HUBRISE_RETIRE_CONFIRM_REQUIRED'),
)

const chooseMode = (next: HubriseSyncMode) => {
  mode.value = next
  confirmRetire.value = false
  catalog.reset()
}

const preview = async () => {
  confirmRetire.value = false
  // A full import is previewed by the dry run, which is also what enabling the import later asks for.
  await catalog.preview(mode.value === 'FULL' ? 'DRY_RUN' : mode.value)
}

const apply = async () => {
  applying.value = true
  try {
    const result = await catalog.sync(mode.value, confirmRetire.value)
    if (result?.applied === true) {
      toast.add({ title: t('hubrise.import.applied'), color: 'success' })
      emit('applied')
    }
  } finally {
    applying.value = false
  }
}
</script>

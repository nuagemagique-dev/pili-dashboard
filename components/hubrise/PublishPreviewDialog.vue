<template>
  <HubriseDialog
    :open="open"
    :title="t('hubrise.preview.title')"
    :description="t('hubrise.preview.description')"
    @update:open="(value) => emit('update:open', value)"
  >
    <p v-if="publish.loadingPreview.value && !plan" class="text-sm text-muted">
      {{ t('hubrise.preview.loading') }}
    </p>

    <p
      v-if="publish.error.value"
      role="alert"
      class="text-sm font-bold"
      :class="publish.stale.value ? 'text-warning' : 'text-error'"
      data-testid="hubrise-preview-error"
    >
      {{ t(publish.error.value.key, publish.error.value.params) }}
      <span v-if="publish.retryIn.value > 0" data-testid="hubrise-preview-countdown">
        {{ t('hubrise.preview.retryIn', { time: formatCountdown(publish.retryIn.value) }) }}
      </span>
    </p>
    <UButton
      v-if="publish.error.value && !plan"
      :label="t('hubrise.preview.retry')"
      icon="i-lucide-refresh-cw"
      color="neutral"
      variant="outline"
      class="self-start"
      :disabled="busy || publish.retryIn.value > 0"
      @click="reloadWithForeign(removeForeign)"
    />

    <template v-if="plan">
      <p v-if="plan.firstPublish" class="p-3 rounded-[10px] bg-accented text-sm leading-snug">
        {{ t('hubrise.preview.firstPublish') }}
      </p>

      <ul class="grid grid-cols-2 sm:grid-cols-5 gap-2" data-testid="hubrise-preview-counts">
        <li
          v-for="count in COUNTS"
          :key="count"
          class="p-2.5 rounded-[10px] bg-elevated border border-default text-center"
        >
          <span class="block font-mono text-xl font-bold tabular-nums">{{ plan[count] }}</span>
          <span class="block text-xs text-muted">{{ t(`hubrise.preview.counts.${count}`) }}</span>
        </li>
      </ul>

      <ul v-if="rows.length" class="flex flex-col gap-1 text-sm">
        <li v-for="row in rows" :key="row.entity" class="flex gap-3">
          <span class="font-bold min-w-28">{{ t(`hubrise.entities.${row.entity}`) }}</span>
          <span class="text-muted">{{
            t('hubrise.preview.rowCounts', {
              added: row.added,
              updated: row.updated,
              removed: row.removed,
            })
          }}</span>
        </li>
      </ul>

      <p v-if="!hasChanges" class="text-sm text-muted">{{ t('hubrise.preview.nothingToDo') }}</p>

      <section
        v-for="group in groups"
        :key="group.action"
        class="flex flex-col gap-1.5"
        :data-group="group.action"
      >
        <h4
          class="font-mono text-xs font-bold tracking-[0.06em] uppercase"
          :class="group.action === 'REMOVE' ? 'text-error' : 'text-muted'"
        >
          {{ t(`hubrise.preview.actions.${group.action}`, { count: group.changes.length }) }}
        </h4>
        <ul
          class="max-h-56 overflow-y-auto divide-y divide-default rounded-[10px] border border-default"
        >
          <li
            v-for="change in group.changes"
            :key="`${change.entity}|${change.key}`"
            class="px-3 py-2 flex items-center gap-2 flex-wrap"
          >
            <PiliChip tone="outline" size="sm">{{
              t(`hubrise.entities.${change.entity}`)
            }}</PiliChip>
            <span class="text-sm font-bold min-w-0 truncate">{{ change.name }}</span>
            <span class="font-mono text-xs text-muted">{{ change.ref }}</span>
            <span v-if="change.fields.length" class="text-xs text-muted">{{
              change.fields.join(', ')
            }}</span>
          </li>
        </ul>
      </section>
      <p v-if="plan.truncated" class="text-xs text-muted" data-testid="hubrise-preview-truncated">
        {{ t('hubrise.preview.truncated') }}
      </p>

      <section v-if="plan.foreign > 0 || plan.foreignItems.length" class="flex flex-col gap-1.5">
        <h4 class="font-mono text-xs font-bold tracking-[0.06em] uppercase text-muted">
          {{ t('hubrise.preview.foreignTitle', { count: plan.foreign }) }}
        </h4>
        <p class="text-xs text-muted leading-snug">{{ t('hubrise.preview.foreignHint') }}</p>
        <ul class="max-h-40 overflow-y-auto text-sm flex flex-col gap-0.5">
          <li v-for="item in plan.foreignItems" :key="`${item.entity}|${item.ref}`">
            <span class="font-bold">{{ item.name }}</span>
            <span class="font-mono text-xs text-muted"> {{ item.ref }}</span>
          </li>
        </ul>
        <UCheckbox
          v-model="removeForeign"
          :label="t('hubrise.preview.removeForeign', { count: plan.foreign })"
          :disabled="busy"
          @update:model-value="(value) => reloadWithForeign(value === true)"
        />
      </section>

      <section v-if="plan.preserved.length" class="flex flex-col gap-1.5">
        <h4 class="font-mono text-xs font-bold tracking-[0.06em] uppercase text-muted">
          {{ t('hubrise.preview.preserved') }}
        </h4>
        <div class="flex flex-wrap gap-1.5">
          <PiliChip v-for="section in plan.preserved" :key="section" tone="neutral" size="sm">{{
            section
          }}</PiliChip>
        </div>
      </section>

      <section
        v-if="plan.warnings.length"
        class="flex flex-col gap-1.5"
        data-testid="hubrise-preview-warnings"
      >
        <h4 class="font-mono text-xs font-bold tracking-[0.06em] uppercase text-warning">
          {{ t('hubrise.preview.warnings') }}
        </h4>
        <ul class="text-sm flex flex-col gap-1">
          <li v-for="issue in plan.warnings" :key="`${issue.code}|${issue.key}`">
            {{ issue.message }}
          </li>
        </ul>
      </section>

      <section
        v-if="plan.blockers.length"
        class="flex flex-col gap-1.5"
        data-testid="hubrise-preview-blockers"
      >
        <h4 class="font-mono text-xs font-bold tracking-[0.06em] uppercase text-error">
          {{ t('hubrise.preview.blockers') }}
        </h4>
        <ul class="text-sm flex flex-col gap-1 text-error">
          <li v-for="issue in plan.blockers" :key="`${issue.code}|${issue.key}`">
            {{ issue.message }}
          </li>
        </ul>
      </section>

      <section
        v-if="expected !== null"
        class="flex flex-col gap-1.5"
        data-testid="hubrise-preview-typed"
      >
        <p class="text-sm font-bold text-error leading-snug">
          {{ t('hubrise.preview.typedPrompt', { count: expected }) }}
        </p>
        <UInput
          v-model="typed"
          inputmode="numeric"
          :placeholder="expected"
          :aria-label="t('hubrise.preview.typedLabel')"
        />
      </section>
    </template>

    <template #footer>
      <UButton
        :label="t('common.cancel')"
        color="neutral"
        variant="ghost"
        @click="emit('update:open', false)"
      />
      <UButton
        :label="
          plan?.firstPublish ? t('hubrise.preview.confirmFirst') : t('hubrise.preview.confirm')
        "
        icon="i-lucide-cloud-upload"
        :loading="publish.publishing.value"
        :disabled="!canConfirm"
        @click="confirm"
      />
    </template>
  </HubriseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import HubriseDialog from '~/components/hubrise/HubriseDialog.vue'
import {
  canConfirmPublish,
  formatCountdown,
  groupPublishChanges,
  previewHasChanges,
  publishCountRows,
  typedConfirmation,
} from '~/utils/hubrise'

const { open } = defineProps<{ open: boolean }>()

const emit = defineEmits<{ 'update:open': [open: boolean]; published: [queued: boolean] }>()

const { t } = useI18n()
const publish = useHubrisePublish()

const COUNTS = ['added', 'updated', 'removed', 'unchanged', 'foreign'] as const

const removeForeign = ref(false)
const typed = ref('')

const plan = computed(() => publish.preview.value)
const busy = computed(() => publish.loadingPreview.value || publish.publishing.value)
const groups = computed(() => (plan.value ? groupPublishChanges(plan.value.changes) : []))
const rows = computed(() => (plan.value ? publishCountRows(plan.value) : []))
const hasChanges = computed(() => (plan.value ? previewHasChanges(plan.value) : false))
const expected = computed(() => (plan.value ? typedConfirmation(plan.value) : null))
const canConfirm = computed(
  () =>
    plan.value !== null &&
    publish.retryIn.value === 0 &&
    canConfirmPublish(plan.value, typed.value, busy.value),
)

// Every opening reads the plan afresh: it is only valid for the menu as it is now.
watch(
  () => open,
  async (isOpen) => {
    if (!isOpen) return
    publish.reset()
    removeForeign.value = false
    typed.value = ''
    await publish.loadPreview(false)
  },
  { immediate: true },
)

// The plan depends on removeForeign, and a new plan needs its own typed confirmation.
const reloadWithForeign = async (value: boolean) => {
  typed.value = ''
  await publish.loadPreview(value)
}

const confirm = async () => {
  if (plan.value === null) return
  const result = await publish.publish(plan.value, removeForeign.value)
  if (result === null) {
    typed.value = ''
    return
  }
  emit('published', result.queued)
  emit('update:open', false)
}
</script>

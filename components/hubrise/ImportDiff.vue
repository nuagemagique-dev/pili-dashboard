<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      <span>{{ t('hubrise.import.linked', { count: diff.linkedProducts }) }}</span>
      <span>{{ t('hubrise.import.unchanged', { count: diff.unchanged }) }}</span>
      <span v-if="diff.retiringProducts > 0" class="text-error font-bold">{{
        t('hubrise.import.retiring', { count: diff.retiringProducts })
      }}</span>
    </div>

    <p v-if="groups.length === 0" class="text-sm text-muted">{{ t('hubrise.import.noChanges') }}</p>
    <section v-for="group in groups" :key="group.action" class="flex flex-col gap-1.5">
      <h4 class="font-mono text-xs font-bold tracking-[0.06em] uppercase text-muted">
        {{ t(`hubrise.import.actions.${group.action}`, { count: group.changes.length }) }}
      </h4>
      <ul
        class="max-h-64 overflow-y-auto divide-y divide-default rounded-[10px] border border-default"
      >
        <li
          v-for="change in group.changes"
          :key="`${change.entity}|${change.key}`"
          class="px-3 py-2 flex items-center gap-2 flex-wrap"
        >
          <PiliChip tone="outline" size="sm">{{ t(`hubrise.entities.${change.entity}`) }}</PiliChip>
          <span class="text-sm font-bold min-w-0 truncate">{{ change.name }}</span>
          <span v-if="change.fields.length" class="text-xs text-muted">{{
            change.fields.join(', ')
          }}</span>
        </li>
      </ul>
    </section>

    <section v-if="diff.conflicts.length" class="flex flex-col gap-1.5">
      <h4 class="font-mono text-xs font-bold tracking-[0.06em] uppercase text-warning">
        {{ t('hubrise.import.conflicts') }}
      </h4>
      <ul class="flex flex-col gap-1 text-sm">
        <li v-for="issue in diff.conflicts" :key="`${issue.code}|${issue.key}`">
          {{ issue.message }}
        </li>
      </ul>
    </section>

    <section v-if="diff.warnings.length" class="flex flex-col gap-1.5">
      <h4 class="font-mono text-xs font-bold tracking-[0.06em] uppercase text-muted">
        {{ t('hubrise.import.warnings') }}
      </h4>
      <ul class="flex flex-col gap-1 text-sm text-muted">
        <li v-for="issue in diff.warnings" :key="`${issue.code}|${issue.key}`">
          {{ issue.message }}
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { type HubriseCatalogDiff, groupImportChanges } from '~/utils/hubrise'

const { diff } = defineProps<{ diff: HubriseCatalogDiff }>()

const { t } = useI18n()
const groups = computed(() => groupImportChanges(diff.changes))
</script>

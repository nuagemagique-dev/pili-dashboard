<template>
  <div class="flex-1 flex flex-col">
    <!-- Mobile -->
    <template v-if="isMobile">
      <PiliSubHeader :title="t('navigation.settings')" />

      <div class="px-4 pt-1 pb-5 grid auto-rows-max gap-2.5">
        <!-- Online ordering: the whole card is the toggle -->
        <button
          type="button"
          role="switch"
          :aria-checked="orderingEnabled"
          :disabled="updatingOrdering"
          class="p-4 rounded-[14px] bg-elevated border border-default flex items-center gap-3.5 text-left cursor-pointer"
          @click="toggleOrdering(!orderingEnabled)"
        >
          <span class="flex-1 min-w-0 flex flex-col gap-1">
            <span class="text-base font-bold">{{ t('settings.ordering.title') }}</span>
            <span class="text-[13px] text-muted leading-snug">{{
              t('settings.ordering.description')
            }}</span>
          </span>
          <PiliSwitch
            :model-value="orderingEnabled"
            size="lg"
            :loading="updatingOrdering"
            presentational
          />
        </button>

        <!-- Preparation time -->
        <div class="p-4 rounded-[14px] bg-elevated border border-default flex flex-col gap-3.5">
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-base font-bold">{{ t('settings.preparation.title') }}</span>
              <PiliChip v-if="preparationDirty" tone="warning" size="sm">{{
                t('settings.unsaved')
              }}</PiliChip>
            </div>
            <span class="text-[13px] text-muted leading-snug">{{
              t('settings.preparation.description')
            }}</span>
          </div>
          <div class="grid grid-cols-[56px_1fr_56px] items-center gap-2">
            <button
              type="button"
              :disabled="preparationMinutes <= MIN_PREPARATION_MINUTES"
              :aria-label="t('settings.preparation.label')"
              class="h-14 rounded-xl bg-accented font-mono text-2xl font-bold disabled:opacity-40 active:bg-(--pili-pressed)"
              @click="adjustPreparation(-5)"
            >
              −
            </button>
            <span class="text-center font-mono tabular-nums">
              <span class="text-4xl font-bold leading-none">{{ preparationMinutes }}</span
              >{{ ' '
              }}<span class="text-sm font-normal text-muted">{{
                t('settings.preparation.unit')
              }}</span>
            </span>
            <button
              type="button"
              :disabled="preparationMinutes >= MAX_PREPARATION_MINUTES"
              :aria-label="t('settings.preparation.label')"
              class="h-14 rounded-xl bg-accented font-mono text-2xl font-bold disabled:opacity-40 active:bg-(--pili-pressed)"
              @click="adjustPreparation(5)"
            >
              +
            </button>
          </div>
        </div>

        <!-- Opening hours -->
        <SettingsSection
          v-model:open="openingHoursOpen"
          :title="t('settings.hours.title')"
          :summary="hoursSummary(localHours)"
          :dirty="openingHoursDirty"
        >
          <ScheduleEditor :hours="localHours" :days="days" @toggle-day="toggleDay" />
        </SettingsSection>

        <!-- Ordering hours -->
        <SettingsSection
          v-model:open="orderingHoursOpen"
          :title="t('settings.orderingHours.title')"
          :summary="
            hasOrderingHours
              ? hoursSummary(localOrderingHours)
              : t('settings.orderingHours.fallbackNotice')
          "
          :dirty="orderingHoursDirty"
        >
          <div class="border-t border-default py-3 flex items-center justify-between gap-4">
            <span class="text-sm leading-snug">{{
              t('settings.orderingHours.customHoursSwitch')
            }}</span>
            <PiliSwitch
              :model-value="hasOrderingHours"
              size="md"
              :label="t('settings.orderingHours.customHoursSwitch')"
              @update:model-value="toggleCustomOrderingHours"
            />
          </div>
          <ScheduleEditor
            v-if="hasOrderingHours"
            :hours="localOrderingHours"
            :days="days"
            @toggle-day="toggleOrderingDay"
          />
        </SettingsSection>

        <!-- Schedule overrides -->
        <div class="rounded-[14px] bg-elevated border border-default overflow-hidden">
          <div class="min-h-16 py-3 pl-4 pr-3 flex items-center gap-3">
            <span class="flex-1 min-w-0 flex flex-col gap-1">
              <span class="text-base font-bold">{{ t('settings.overrides.title') }}</span>
              <span class="text-[13px] text-muted leading-snug">{{
                t('settings.overrides.description')
              }}</span>
            </span>
            <button
              type="button"
              :aria-label="t('settings.overrides.addButton')"
              class="size-11 rounded-[10px] bg-accented flex items-center justify-center shrink-0"
              @click="openAddOverride"
            >
              <UIcon name="i-lucide-plus" class="size-5" />
            </button>
          </div>
          <p
            v-if="overrides.length === 0"
            class="px-4 py-4 border-t border-default text-[13px] text-muted"
          >
            {{ t('settings.overrides.empty') }}
          </p>
          <div
            v-for="ov in overrides"
            :key="ov.date"
            role="button"
            tabindex="0"
            class="pl-4 pr-2 py-3 border-t border-default flex items-center gap-2 cursor-pointer active:bg-accented"
            @click="openEditOverride(ov)"
            @keydown.enter.prevent="openEditOverride(ov)"
            @keydown.space.prevent="openEditOverride(ov)"
          >
            <div class="flex-1 min-w-0 flex flex-col gap-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[15px] font-bold">{{ formatOverrideDate(ov.date) }}</span>
                <PiliChip :tone="ov.closed ? 'danger' : 'warning'" size="sm">
                  {{
                    ov.closed
                      ? t('settings.overrides.labelClosed')
                      : t('settings.overrides.labelSpecialHours')
                  }}
                </PiliChip>
              </div>
              <span v-if="overrideDetail(ov)" class="text-[13px] text-muted">{{
                overrideDetail(ov)
              }}</span>
            </div>
            <UDropdownMenu :items="overrideMenuItems(ov)" :content="{ align: 'end' }">
              <UButton
                icon="i-lucide-ellipsis-vertical"
                variant="ghost"
                color="neutral"
                square
                :aria-label="t('common.actions')"
                @click.stop
              />
            </UDropdownMenu>
          </div>
        </div>

        <!-- Staff two-factor authentication -->
        <SecuritySettings />
      </div>
    </template>

    <!-- Desktop -->
    <div v-else class="p-3 sm:p-4 md:p-6 max-w-4xl mx-auto space-y-3 sm:space-y-4 w-full">
      <h1 class="text-lg sm:text-2xl font-bold">{{ t('settings.title') }}</h1>

      <!-- Online ordering toggle -->
      <div class="bg-elevated border border-default rounded-[14px] px-4 py-4 sm:px-5">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <h2 class="text-base sm:text-lg font-semibold leading-tight">
              {{ t('settings.ordering.title') }}
            </h2>
            <p class="text-xs sm:text-sm text-muted mt-1 leading-snug">
              {{ t('settings.ordering.description') }}
            </p>
          </div>
          <USwitch
            v-model="orderingEnabled"
            size="lg"
            color="success"
            :loading="updatingOrdering"
            checked-icon="i-lucide-check"
            unchecked-icon="i-lucide-x"
            @update:model-value="toggleOrdering"
          />
        </div>
      </div>

      <!-- Preparation time -->
      <div class="bg-elevated border border-default rounded-[14px] px-4 py-4 sm:px-5">
        <div class="flex items-start gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-base sm:text-lg font-semibold leading-tight">
                {{ t('settings.preparation.title') }}
              </h2>
              <UBadge
                v-if="preparationDirty"
                :label="t('settings.unsaved')"
                color="warning"
                variant="solid"
                size="sm"
                class="rounded-[5px] text-[11px] font-bold"
              />
            </div>
            <p class="text-xs sm:text-sm text-muted mt-1 leading-snug">
              {{ t('settings.preparation.description') }}
            </p>
          </div>
        </div>

        <div class="mt-4 flex items-center justify-center gap-3 sm:justify-start">
          <UButton
            icon="i-lucide-minus"
            variant="solid"
            color="neutral"
            size="lg"
            square
            :disabled="preparationMinutes <= MIN_PREPARATION_MINUTES"
            :aria-label="t('common.actions')"
            @click.prevent="adjustPreparation(-5)"
          />
          <div class="flex items-baseline gap-1.5 min-w-[120px] justify-center">
            <span class="text-3xl font-semibold font-mono tabular-nums leading-none">{{
              preparationMinutes
            }}</span>
            <span class="text-sm text-muted">{{ t('settings.preparation.unit') }}</span>
          </div>
          <UButton
            icon="i-lucide-plus"
            variant="solid"
            color="neutral"
            size="lg"
            square
            :disabled="preparationMinutes >= MAX_PREPARATION_MINUTES"
            :aria-label="t('common.actions')"
            @click.prevent="adjustPreparation(5)"
          />
        </div>

        <UButton
          v-if="preparationDirty"
          :label="t('common.save')"
          icon="i-lucide-save"
          :loading="updatingPreparation"
          :color="firstDirty === 'preparation' ? 'primary' : 'neutral'"
          variant="solid"
          block
          class="mt-4"
          @click.prevent="savePreparation"
        />
      </div>

      <!-- Opening hours -->
      <SettingsSection
        v-model:open="openingHoursOpen"
        :title="t('settings.hours.title')"
        :description="t('settings.hours.description')"
        :dirty="openingHoursDirty"
      >
        <div class="space-y-4">
          <ScheduleEditor :hours="localHours" :days="days" @toggle-day="toggleDay" />
          <UButton
            v-if="openingHoursDirty"
            :label="t('common.save')"
            icon="i-lucide-save"
            :loading="updatingHours"
            :color="firstDirty === 'hours' ? 'primary' : 'neutral'"
            variant="solid"
            block
            @click="saveOpeningHours"
          />
        </div>
      </SettingsSection>

      <!-- Ordering hours -->
      <SettingsSection
        v-model:open="orderingHoursOpen"
        :title="t('settings.orderingHours.title')"
        :description="t('settings.orderingHours.description')"
        :dirty="orderingHoursDirty"
      >
        <div class="space-y-4">
          <div class="flex items-center justify-between gap-4 py-1">
            <span class="text-sm leading-snug">{{
              t('settings.orderingHours.customHoursSwitch')
            }}</span>
            <USwitch
              :model-value="hasOrderingHours"
              size="md"
              color="success"
              checked-icon="i-lucide-check"
              unchecked-icon="i-lucide-x"
              @update:model-value="toggleCustomOrderingHours"
            />
          </div>
          <ScheduleEditor
            v-if="hasOrderingHours"
            :hours="localOrderingHours"
            :days="days"
            @toggle-day="toggleOrderingDay"
          />
          <p v-else class="text-xs sm:text-sm text-muted italic">
            {{ t('settings.orderingHours.fallbackNotice') }}
          </p>
          <UButton
            v-if="orderingHoursDirty"
            :label="t('common.save')"
            icon="i-lucide-save"
            :loading="updatingOrderingHours"
            :color="firstDirty === 'orderingHours' ? 'primary' : 'neutral'"
            variant="solid"
            block
            @click="saveOrderingHours"
          />
        </div>
      </SettingsSection>

      <!-- Schedule overrides -->
      <SettingsSection
        v-model:open="overridesOpen"
        :title="t('settings.overrides.title')"
        :description="t('settings.overrides.description')"
      >
        <template #actions>
          <UButton
            icon="i-lucide-plus"
            size="sm"
            color="neutral"
            variant="solid"
            square
            :aria-label="t('settings.overrides.addButton')"
            @click="openAddOverride"
          />
        </template>

        <!-- Empty state -->
        <div
          v-if="overrides.length === 0"
          class="py-8 flex flex-col items-center text-center gap-3"
        >
          <div class="size-12 rounded-full bg-accented flex items-center justify-center">
            <UIcon name="i-lucide-calendar-off" class="size-6 text-muted" />
          </div>
          <p class="text-sm text-muted max-w-xs">{{ t('settings.overrides.empty') }}</p>
          <UButton
            :label="t('settings.overrides.addButton')"
            icon="i-lucide-plus"
            size="sm"
            color="neutral"
            variant="solid"
            @click="openAddOverride"
          />
        </div>

        <!-- Overrides list -->
        <ul v-else class="space-y-2">
          <li v-for="ov in overrides" :key="ov.date">
            <div
              role="button"
              tabindex="0"
              class="rounded-xl border border-default bg-accented p-3 sm:p-4 flex items-start gap-3 cursor-pointer transition-colors hover:border-muted focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-inverted"
              @click="openEditOverride(ov)"
              @keydown.enter.prevent="openEditOverride(ov)"
              @keydown.space.prevent="openEditOverride(ov)"
            >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium text-sm">{{ formatOverrideDate(ov.date) }}</span>
                  <UBadge
                    :label="
                      ov.closed
                        ? t('settings.overrides.labelClosed')
                        : t('settings.overrides.labelSpecialHours')
                    "
                    :color="ov.closed ? 'error' : 'warning'"
                    variant="solid"
                    size="sm"
                    class="rounded-[5px] text-[11px] font-bold"
                  />
                </div>
                <p v-if="ov.note" class="text-xs text-muted mt-1 line-clamp-2">{{ ov.note }}</p>
                <p
                  v-if="!ov.closed && ov.schedule"
                  class="text-xs text-muted mt-1 font-mono tabular-nums"
                >
                  {{ ov.schedule.open }}–{{ ov.schedule.close
                  }}<span v-if="ov.schedule.dinnerOpen && ov.schedule.dinnerClose">
                    · {{ ov.schedule.dinnerOpen }}–{{ ov.schedule.dinnerClose }}</span
                  >
                </p>
              </div>
              <UDropdownMenu :items="overrideMenuItems(ov)" :content="{ align: 'end' }">
                <UButton
                  icon="i-lucide-ellipsis-vertical"
                  variant="ghost"
                  color="neutral"
                  size="sm"
                  square
                  :aria-label="t('common.actions')"
                  @click.stop
                />
              </UDropdownMenu>
            </div>
          </li>
        </ul>
      </SettingsSection>

      <!-- Staff two-factor authentication -->
      <SecuritySettings />
    </div>

    <!-- Override editor: restyled bottom sheet on mobile, side panel on desktop -->
    <USlideover
      v-model:open="modalOpen"
      :side="sheetSide"
      :ui="sheetUi"
      :title="
        editingDate ? t('settings.overrides.modalTitleEdit') : t('settings.overrides.modalTitleAdd')
      "
    >
      <template #body>
        <div class="space-y-5">
          <!-- Date -->
          <div>
            <label class="block text-sm font-medium mb-1.5">{{
              t('settings.overrides.fieldDate')
            }}</label>
            <input
              v-model="form.date"
              type="date"
              :disabled="!!editingDate"
              class="border border-default rounded-lg px-3 py-2.5 text-base bg-accented w-full disabled:opacity-60"
            />
          </div>

          <!-- End date (range, add mode only) -->
          <div v-if="!editingDate">
            <label class="block text-sm font-medium mb-1.5">{{
              t('settings.overrides.fieldDateEnd')
            }}</label>
            <input
              v-model="form.dateEnd"
              type="date"
              :min="form.date"
              class="border border-default rounded-lg px-3 py-2.5 text-base bg-accented w-full"
            />
            <p class="text-xs text-muted mt-1">{{ t('settings.overrides.dateEndHint') }}</p>
          </div>

          <!-- Type segmented control -->
          <div>
            <label class="block text-sm font-medium mb-1.5">{{
              t('settings.overrides.fieldType')
            }}</label>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                class="flex flex-col items-center justify-center rounded-xl border-2 transition-colors py-3 cursor-pointer min-h-[68px]"
                :class="
                  form.closed
                    ? 'border-inverted bg-inverted text-inverted'
                    : 'border-default bg-accented text-default hover:border-muted'
                "
                @click.prevent="form.closed = true"
              >
                <UIcon name="i-lucide-x-circle" class="size-5 mb-1" />
                <span class="text-sm font-medium">{{ t('settings.overrides.typeClosed') }}</span>
              </button>
              <button
                type="button"
                class="flex flex-col items-center justify-center rounded-xl border-2 transition-colors py-3 cursor-pointer min-h-[68px]"
                :class="
                  !form.closed
                    ? 'border-inverted bg-inverted text-inverted'
                    : 'border-default bg-accented text-default hover:border-muted'
                "
                @click.prevent="form.closed = false"
              >
                <UIcon name="i-lucide-clock" class="size-5 mb-1" />
                <span class="text-sm font-medium">{{ t('settings.overrides.typeSpecial') }}</span>
              </button>
            </div>
          </div>

          <!-- Special hours -->
          <div v-if="!form.closed" class="space-y-3">
            <div>
              <label class="block text-xs uppercase tracking-wide text-muted mb-1.5">
                {{ t('settings.hours.lunch') }}
              </label>
              <div class="flex items-center gap-2">
                <input
                  v-model="form.schedule.open"
                  type="time"
                  class="flex-1 min-w-0 border border-default rounded-lg px-3 py-2.5 text-base bg-accented font-mono tabular-nums"
                />
                <span class="text-muted">–</span>
                <input
                  v-model="form.schedule.close"
                  type="time"
                  class="flex-1 min-w-0 border border-default rounded-lg px-3 py-2.5 text-base bg-accented font-mono tabular-nums"
                />
              </div>
            </div>
            <div>
              <label class="block text-xs uppercase tracking-wide text-muted mb-1.5">
                {{ t('settings.hours.dinner') }}
              </label>
              <div class="flex items-center gap-2">
                <input
                  v-model="form.schedule.dinnerOpen"
                  type="time"
                  class="flex-1 min-w-0 border border-default rounded-lg px-3 py-2.5 text-base bg-accented font-mono tabular-nums"
                />
                <span class="text-muted">–</span>
                <input
                  v-model="form.schedule.dinnerClose"
                  type="time"
                  class="flex-1 min-w-0 border border-default rounded-lg px-3 py-2.5 text-base bg-accented font-mono tabular-nums"
                />
              </div>
            </div>
          </div>

          <!-- Note -->
          <div>
            <label class="block text-sm font-medium mb-1.5">{{
              t('settings.overrides.fieldNote')
            }}</label>
            <input
              v-model="form.note"
              type="text"
              :placeholder="t('settings.overrides.notePlaceholder')"
              class="border border-default rounded-lg px-3 py-2.5 text-base bg-accented w-full"
            />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex gap-2 w-full">
          <UButton
            :label="t('settings.overrides.cancel')"
            variant="solid"
            color="neutral"
            class="flex-1 justify-center max-md:h-[52px]"
            @click.prevent="modalOpen = false"
          />
          <UButton
            :label="t('settings.overrides.save')"
            icon="i-lucide-save"
            :loading="savingOverride"
            class="flex-1 justify-center max-md:h-[52px]"
            @click.prevent="saveOverride"
          />
        </div>
      </template>
    </USlideover>

    <!-- Mobile: one save bar while any section is dirty -->
    <PiliStickyBar v-if="isMobile && isAnyDirty">
      <div class="grid grid-cols-[1fr_2fr] gap-2">
        <button
          type="button"
          :disabled="savingAll"
          class="h-[52px] rounded-xl bg-accented text-[15px] font-bold disabled:opacity-60"
          @click="cancelAll"
        >
          {{ t('settings.overrides.cancel') }}
        </button>
        <button
          type="button"
          :disabled="savingAll"
          class="h-[52px] rounded-xl bg-primary text-inverted text-base font-bold disabled:opacity-60"
          @click="saveAll"
        >
          {{ t('common.save') }}
        </button>
      </div>
    </PiliStickyBar>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useGqlSubscription, useNuxtApp } from '#imports'
import type { DropdownMenuItem } from '@nuxt/ui'
import ScheduleEditor from '~/components/ScheduleEditor.vue'
import SecuritySettings from '~/components/SecuritySettings.vue'
import SettingsSection from '~/components/SettingsSection.vue'
import {
  defaultOverrideDate,
  formatOverrideDate as formatOverrideDateIn,
} from '~/utils/scheduleOverride'
import {
  MAX_PREPARATION_MINUTES,
  MIN_PREPARATION_MINUTES,
  OVERRIDE_RANGE_CONFIRM_ABOVE,
  adjustPreparation as adjustedPreparation,
  buildHoursInput,
  buildOverrideInputs,
  copyOpeningHours,
  DAYS as days,
  defaultSchedule,
  emptyOverrideForm,
  isValidPreparation,
  overrideDates,
  overrideDetail,
  overrideToForm,
  parseSchedule,
  saveDirtySteps,
  hoursSummary as summarizeHours,
  type OpeningHoursMap,
  type ScheduleOverride,
} from '~/utils/settings'
import { onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()
const { $gqlFetch } = useNuxtApp()
const isMobile = useIsMobile()
const { hide: hideTabBar, show: showTabBar } = useTabBar()
// Shared online-ordering flag (mobile orders header, Plus page): kept in sync below
const { enabled: sharedOrdering } = useOrderingStatus()

// Section open state
const openingHoursOpen = ref(true)
const orderingHoursOpen = ref(false)
const overridesOpen = ref(false)

/*
 * Per-section dirty state. The `syncing` flag suppresses the deep watchers
 * below while applying server data, so loading config doesn't flag the form dirty.
 */
const preparationDirty = ref(false)
const openingHoursDirty = ref(false)
const orderingHoursDirty = ref(false)
const isAnyDirty = computed(
  () => preparationDirty.value || openingHoursDirty.value || orderingHoursDirty.value,
)
// Only the first dirty section's save button is Volt (one Volt element per page)
const firstDirty = computed<'preparation' | 'hours' | 'orderingHours' | null>(() => {
  if (preparationDirty.value) return 'preparation'
  if (openingHoursDirty.value) return 'hours'
  if (orderingHoursDirty.value) return 'orderingHours'
  return null
})
let syncing = false

const resetDirty = () => {
  preparationDirty.value = false
  openingHoursDirty.value = false
  orderingHoursDirty.value = false
}

const orderingEnabled = ref(true)
const preparationMinutes = ref(30)
const updatingOrdering = ref(false)
const updatingHours = ref(false)
const updatingOrderingHours = ref(false)
const updatingPreparation = ref(false)
const localHours: OpeningHoursMap = reactive({
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
})
const localOrderingHours: OpeningHoursMap = reactive({
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
})
const overrides = ref<ScheduleOverride[]>([])

const hasOrderingHours = computed(() => days.some((d) => localOrderingHours[d.key] !== null))

// Mobile: bottom sheet restyled like PiliBottomSheet; desktop: side panel
const sheetSide = computed<'right' | 'bottom'>(() => (isMobile.value ? 'bottom' : 'right'))
const sheetUi = computed(() =>
  isMobile.value
    ? {
        overlay: 'bg-black/70',
        content:
          "max-h-[92dvh] bg-elevated border-t border-default rounded-t-[20px] ring-0 shadow-none before:content-[''] before:block before:shrink-0 before:w-10 before:h-1 before:rounded-sm before:bg-(--pili-pressed) before:mx-auto before:mt-2.5",
      }
    : { content: 'max-w-md' },
)

const GET_CONFIG = /* GraphQL */ `
  query {
    restaurantConfig {
      orderingEnabled
      openingHours
      orderingHours
      preparationMinutes
    }
  }
`

const GET_OVERRIDES = /* GraphQL */ `
  query ScheduleOverrides($from: DateTime!, $to: DateTime!) {
    scheduleOverrides(from: $from, to: $to) {
      date
      closed
      schedule {
        open
        close
        dinnerOpen
        dinnerClose
      }
      note
      updatedAt
    }
  }
`

const UPDATE_ORDERING = /* GraphQL */ `
  mutation UpdateOrderingEnabled($enabled: Boolean!) {
    updateOrderingEnabled(enabled: $enabled) {
      orderingEnabled
    }
  }
`

const UPDATE_HOURS = /* GraphQL */ `
  mutation UpdateOpeningHours($hours: OpeningHoursInput!) {
    updateOpeningHours(hours: $hours) {
      openingHours
    }
  }
`

const UPDATE_ORDERING_HOURS = /* GraphQL */ `
  mutation UpdateOrderingHours($hours: OpeningHoursInput!) {
    updateOrderingHours(hours: $hours) {
      orderingHours
    }
  }
`

const UPDATE_PREPARATION = /* GraphQL */ `
  mutation UpdatePreparationMinutes($minutes: Int!) {
    updatePreparationMinutes(minutes: $minutes) {
      preparationMinutes
    }
  }
`

const UPSERT_OVERRIDE = /* GraphQL */ `
  mutation UpsertScheduleOverride($input: ScheduleOverrideInput!) {
    upsertScheduleOverride(input: $input) {
      date
      closed
      schedule {
        open
        close
        dinnerOpen
        dinnerClose
      }
      note
      updatedAt
    }
  }
`

const DELETE_OVERRIDE = /* GraphQL */ `
  mutation DeleteScheduleOverride($date: DateTime!) {
    deleteScheduleOverride(date: $date)
  }
`

const loadConfig = async () => {
  const data = await $gqlFetch<{
    restaurantConfig: {
      orderingEnabled: boolean
      openingHours: OpeningHoursMap
      orderingHours: OpeningHoursMap | null
      preparationMinutes: number
    }
  }>(GET_CONFIG)
  if (data) {
    syncing = true
    orderingEnabled.value = data.restaurantConfig.orderingEnabled
    sharedOrdering.value = data.restaurantConfig.orderingEnabled
    preparationMinutes.value = data.restaurantConfig.preparationMinutes
    for (const day of days) {
      localHours[day.key] = parseSchedule(data.restaurantConfig.openingHours[day.key])
      localOrderingHours[day.key] = data.restaurantConfig.orderingHours
        ? parseSchedule(data.restaurantConfig.orderingHours[day.key])
        : null
    }
    await nextTick()
    syncing = false
    resetDirty()
  }
}

const loadOverrides = async () => {
  const from = new Date().toISOString()
  const to = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString()
  const data = await $gqlFetch<{ scheduleOverrides: ScheduleOverride[] }>(GET_OVERRIDES, {
    variables: { from, to },
  })
  if (data) {
    overrides.value = data.scheduleOverrides
  }
}

const toggleOrdering = async (enabled: boolean) => {
  updatingOrdering.value = true
  try {
    await $gqlFetch(UPDATE_ORDERING, { variables: { enabled } })
    orderingEnabled.value = enabled
    sharedOrdering.value = enabled
  } finally {
    updatingOrdering.value = false
  }
}

const toggleDay = (dayKey: string, open: boolean) => {
  localHours[dayKey] = open ? defaultSchedule() : null
  openingHoursDirty.value = true
}

const toggleOrderingDay = (dayKey: string, open: boolean) => {
  localOrderingHours[dayKey] = open ? defaultSchedule() : null
  orderingHoursDirty.value = true
}

const toggleCustomOrderingHours = (enabled: boolean) => {
  const copy = copyOpeningHours(localHours)
  for (const day of days) {
    localOrderingHours[day.key] = enabled ? (copy[day.key] ?? null) : null
  }
  orderingHoursDirty.value = true
}

const saveOpeningHours = async () => {
  updatingHours.value = true
  try {
    await $gqlFetch(UPDATE_HOURS, { variables: { hours: buildHoursInput(localHours) } })
    openingHoursDirty.value = false
  } finally {
    updatingHours.value = false
  }
}

const saveOrderingHours = async () => {
  updatingOrderingHours.value = true
  try {
    await $gqlFetch(UPDATE_ORDERING_HOURS, {
      variables: { hours: buildHoursInput(localOrderingHours) },
    })
    orderingHoursDirty.value = false
  } finally {
    updatingOrderingHours.value = false
  }
}

const adjustPreparation = (delta: number) => {
  const next = adjustedPreparation(preparationMinutes.value, delta)
  if (next !== preparationMinutes.value) {
    preparationMinutes.value = next
  }
}

const savePreparation = async () => {
  if (!isValidPreparation(preparationMinutes.value)) return
  updatingPreparation.value = true
  try {
    await $gqlFetch(UPDATE_PREPARATION, { variables: { minutes: preparationMinutes.value } })
    preparationDirty.value = false
  } finally {
    updatingPreparation.value = false
  }
}

watch(preparationMinutes, (val, old) => {
  if (!syncing && val !== old) preparationDirty.value = true
})

// Watch deep into localHours / localOrderingHours so per-day time edits flag dirty
watch(
  localHours,
  () => {
    if (!syncing) openingHoursDirty.value = true
  },
  { deep: true },
)
watch(
  localOrderingHours,
  () => {
    if (!syncing) orderingHoursDirty.value = true
  },
  { deep: true },
)

// Mobile save bar: saves every dirty section in sequence, cancel reloads the server values
const savingAll = ref(false)

const saveAll = async () => {
  savingAll.value = true
  try {
    await saveDirtySteps([
      { isDirty: () => preparationDirty.value, save: savePreparation },
      { isDirty: () => openingHoursDirty.value, save: saveOpeningHours },
      { isDirty: () => orderingHoursDirty.value, save: saveOrderingHours },
    ])
  } finally {
    savingAll.value = false
  }
}

const cancelAll = () => loadConfig()

// The save bar replaces the tab bar while something is unsaved
watch(
  [isMobile, isAnyDirty],
  ([mobile, dirty]) => {
    if (mobile && dirty) hideTabBar()
    else showTabBar()
  },
  { immediate: true },
)
onBeforeUnmount(showTabBar)

// "6 jours ouverts · 11:30-14:00 · 17:30-22:00": open-day count + most common lunch / dinner ranges
const hoursSummary = (hours: OpeningHoursMap) => summarizeHours(hours, t)

onBeforeRouteLeave(() => {
  if (isAnyDirty.value) {
    return window.confirm(t('settings.leaveConfirm'))
  }
})

// Override sheet state
const modalOpen = ref(false)
const editingDate = ref<string | null>(null)
const savingOverride = ref(false)
const form = reactive(emptyOverrideForm())

const resetForm = () => {
  Object.assign(form, emptyOverrideForm())
  editingDate.value = null
}

const openAddOverride = () => {
  resetForm()
  form.date = defaultOverrideDate()
  modalOpen.value = true
}

const openEditOverride = (ov: ScheduleOverride) => {
  resetForm()
  editingDate.value = ov.date
  Object.assign(form, overrideToForm(ov))
  modalOpen.value = true
}

const saveOverride = async () => {
  if (!form.date) return
  const dates = overrideDates(form, editingDate.value)
  if (
    dates.length > OVERRIDE_RANGE_CONFIRM_ABOVE &&
    !confirm(t('settings.overrides.confirmRange', { count: dates.length }))
  )
    return
  savingOverride.value = true
  try {
    for (const input of buildOverrideInputs(form, dates)) {
      await $gqlFetch(UPSERT_OVERRIDE, { variables: { input } })
    }
    modalOpen.value = false
    await loadOverrides()
  } finally {
    savingOverride.value = false
  }
}

const deleteOverride = async (date: string) => {
  if (!confirm(t('settings.overrides.confirmDelete'))) return
  await $gqlFetch(DELETE_OVERRIDE, { variables: { date } })
  await loadOverrides()
}

const overrideMenuItems = (ov: ScheduleOverride): DropdownMenuItem[][] => [
  [
    {
      label: t('settings.overrides.editButton'),
      icon: 'i-lucide-pencil',
      onSelect: () => openEditOverride(ov),
    },
    {
      label: t('settings.overrides.deleteButton'),
      icon: 'i-lucide-trash',
      color: 'error',
      onSelect: () => deleteOverride(ov.date),
    },
  ],
]

const formatOverrideDate = (iso: string) => formatOverrideDateIn(iso, locale.value)

const SUB_CONFIG_UPDATED = /* GraphQL */ `
  subscription RestaurantConfigUpdated {
    restaurantConfigUpdated {
      orderingEnabled
      openingHours
      orderingHours
      preparationMinutes
    }
  }
`

const SUB_OVERRIDES_UPDATED = /* GraphQL */ `
  subscription ScheduleOverridesUpdated {
    scheduleOverridesUpdated {
      date
      closed
      schedule {
        open
        close
        dinnerOpen
        dinnerClose
      }
      note
      updatedAt
    }
  }
`

// Subscribe in setup so onScopeDispose ties to the component scope; in onMounted it leaks the WebSocket.
const { data: liveConfig } = useGqlSubscription<{
  restaurantConfigUpdated: {
    orderingEnabled: boolean
    openingHours: OpeningHoursMap
    orderingHours: OpeningHoursMap | null
    preparationMinutes: number
  }
}>(SUB_CONFIG_UPDATED)
watch(liveConfig, async (val) => {
  if (!val?.restaurantConfigUpdated) return
  const cfg = val.restaurantConfigUpdated
  syncing = true
  orderingEnabled.value = cfg.orderingEnabled
  sharedOrdering.value = cfg.orderingEnabled
  preparationMinutes.value = cfg.preparationMinutes
  if (cfg.openingHours) {
    for (const day of days) {
      localHours[day.key] = parseSchedule(cfg.openingHours[day.key])
    }
  }
  for (const day of days) {
    localOrderingHours[day.key] = cfg.orderingHours
      ? parseSchedule(cfg.orderingHours[day.key])
      : null
  }
  await nextTick()
  syncing = false
  resetDirty()
})

const { data: liveOverrides } = useGqlSubscription<{
  scheduleOverridesUpdated: ScheduleOverride[]
}>(SUB_OVERRIDES_UPDATED)
watch(liveOverrides, (val) => {
  if (val?.scheduleOverridesUpdated) {
    overrides.value = val.scheduleOverridesUpdated
  }
})

onMounted(() => {
  loadConfig()
  loadOverrides()
})
</script>

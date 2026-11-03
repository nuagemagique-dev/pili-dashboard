<template>
  <!-- Step 1: name the handheld -->
  <form v-if="!enrollment" class="flex flex-col gap-4" @submit.prevent="submit">
    <p class="text-sm text-muted leading-snug">{{ t('terminals.add.labelHint') }}</p>
    <div class="flex flex-col gap-2">
      <label for="pos-terminal-label" class="text-sm font-medium">{{
        t('terminals.add.label')
      }}</label>
      <UInput
        id="pos-terminal-label"
        v-model="label"
        :maxlength="POS_LABEL_MAX_LENGTH"
        :placeholder="t('terminals.add.labelPlaceholder')"
        size="lg"
        autofocus
      />
    </div>
    <p v-if="error" class="text-sm text-error" role="alert">{{ t(error) }}</p>
    <UButton
      type="submit"
      size="lg"
      class="self-start"
      icon="i-lucide-qr-code"
      :loading="creating"
      :disabled="!isValidPosLabel(label)"
      :label="t('terminals.add.createCode')"
    />
  </form>

  <!-- Step 2: the one-time code, as text and as a QR code -->
  <div v-else class="flex flex-col gap-4" aria-live="polite">
    <p class="text-sm text-muted leading-snug">{{ t('terminals.add.instructions') }}</p>

    <div class="flex flex-col sm:flex-row gap-4 sm:items-center">
      <!-- eslint-disable-next-line vue/no-v-html -- SVG generated locally by uqr from the enrollment payload -->
      <div
        class="bg-white p-3 rounded-xl w-56 h-56 shrink-0 self-center sm:self-auto transition-opacity"
        :class="{ 'opacity-20': expired }"
        :aria-label="t('terminals.add.qrAlt')"
        role="img"
        v-html="qrSvg"
      />
      <div class="flex flex-col gap-3 min-w-0">
        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted">{{ t('terminals.add.code') }}</span>
          <span
            class="font-mono text-4xl font-bold tracking-[0.08em] tabular-nums select-all"
            :class="{ 'line-through text-muted': expired }"
            data-testid="enrollment-code"
            >{{ enrollment.code }}</span
          >
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted">{{ t('terminals.add.server') }}</span>
          <span class="font-mono text-base break-all" data-testid="enrollment-server">{{
            host
          }}</span>
        </div>
        <PiliChip v-if="expired" tone="danger" size="md" class="self-start">{{
          t('terminals.add.expired')
        }}</PiliChip>
        <span v-else class="text-sm text-muted" data-testid="enrollment-countdown">
          {{ t('terminals.add.expiresIn', { time: formatCountdown(secondsLeft) }) }}
        </span>
      </div>
    </div>

    <div class="flex gap-2 flex-wrap">
      <UButton
        v-if="expired"
        icon="i-lucide-refresh-cw"
        :loading="creating"
        :label="t('terminals.add.newCode')"
        @click="emit('create', label)"
      />
      <UButton
        :color="expired ? 'neutral' : 'primary'"
        :variant="expired ? 'ghost' : 'solid'"
        :label="t('common.done')"
        @click="emit('close')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { renderSVG } from 'uqr'
import { useEnrollmentCountdown } from '~/composables/usePosTerminals'
import {
  POS_LABEL_MAX_LENGTH,
  apiHost,
  buildEnrollmentPayload,
  formatCountdown,
  isValidPosLabel,
  type PosEnrollment,
} from '~/utils/posTerminals'

const {
  enrollment,
  apiBaseUrl,
  creating = false,
  error = '',
} = defineProps<{
  enrollment: PosEnrollment | null
  /** The dashboard's public API base URL (runtime config `api`) */
  apiBaseUrl: string
  creating?: boolean
  /** i18n key of the last create error */
  error?: string
}>()

const emit = defineEmits<{
  create: [label: string]
  close: []
}>()

const { t } = useI18n()
const label = ref('')

const host = computed(() => apiHost(apiBaseUrl))
// Generated in the browser, the code is never sent anywhere else.
const qrSvg = computed(() =>
  enrollment ? renderSVG(buildEnrollmentPayload(apiBaseUrl, enrollment.code), { border: 0 }) : '',
)

const { secondsLeft, expired } = useEnrollmentCountdown(toRef(() => enrollment?.expiresAt ?? null))

const submit = () => {
  if (isValidPosLabel(label.value)) emit('create', label.value)
}
</script>

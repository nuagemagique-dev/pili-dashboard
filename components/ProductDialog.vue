<template>
  <UModal
    v-model:open="dialog"
    :title="dialogTitle"
    description=" "
    :overlay="true"
    :fullscreen="isMobile"
    :ui="{
      content: 'max-lg:h-full max-lg:max-h-full max-lg:rounded-none lg:max-w-4xl',
      overlay: 'bg-default',
      body: 'max-lg:p-4 max-lg:overflow-y-auto',
      footer:
        'max-lg:flex-col max-lg:gap-2 max-lg:pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:justify-end max-md:!flex-row max-md:gap-3 max-md:p-4 max-md:pb-[calc(env(safe-area-inset-bottom)+1rem)] max-md:bg-default max-md:border-t max-md:border-default',
    }"
  >
    <template #body>
      <div class="space-y-4 sm:space-y-6 min-w-0 max-md:overflow-x-hidden max-md:[&_label]:text-sm">
        <!-- Row 1: Two Columns -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <!-- Left Column: Category, Code, Price, Piece Count -->
          <div class="space-y-3 sm:space-y-4">
            <UFormField :label="t('products.category')" name="category" required>
              <USelectMenu
                :ui="selectMenuUi"
                v-model="editedProduct.categoryId"
                :items="localizedCategories"
                value-key="id"
                label-key="name"
                :placeholder="t('products.category')"
              />
            </UFormField>

            <UFormField :label="t('products.code')" name="code">
              <UInput
                :ui="monoInputUi"
                v-model="editedProduct.code"
                :placeholder="t('products.code')"
              />
            </UFormField>

            <UFormField :label="t('products.priceEuro')" name="price" required>
              <UInput
                :ui="monoInputUi"
                v-model="editedProduct.price"
                type="number"
                :placeholder="t('products.priceEuro')"
              />
            </UFormField>

            <UFormField :label="t('products.pieceCount')" name="pieceCount">
              <UInput
                :ui="monoInputUi"
                v-model.number="editedProduct.pieceCount"
                type="number"
                :placeholder="t('products.pieceCount')"
              />
            </UFormField>

            <UFormField :label="t('products.vatCategory.label')" name="vatCategory" required>
              <USelect
                :ui="inputUi"
                v-model="editedProduct.vatCategory"
                :items="vatCategoryOptions"
                value-key="value"
                label-key="label"
                :placeholder="t('products.vatCategory.label')"
              />
              <template #help>
                <span class="text-xs text-muted">
                  {{ t('products.vatCategory.help') }}
                </span>
              </template>
            </UFormField>
          </div>

          <!-- Right Column: Image Preview / Upload (shown first on mobile) -->
          <div class="flex flex-col items-center justify-center order-first md:order-none">
            <div v-if="hasImage" class="flex flex-col items-center justify-center gap-3 sm:gap-4">
              <img
                :src="imageUrl"
                alt="Product image"
                class="w-32 max-h-32 sm:w-40 sm:max-h-40 object-contain rounded-lg"
              />
              <UButton variant="ghost" color="neutral" @click="removeImage">
                {{ t('products.removeImage') }}
              </UButton>
            </div>
            <div v-else class="flex flex-col items-center justify-center gap-3 sm:gap-4 w-full">
              <!-- Processed preview (after background removal) -->
              <div v-if="processedPreview" class="flex flex-col items-center gap-2">
                <p class="text-xs text-muted">{{ t('products.previewResult') }}</p>
                <img
                  :src="processedPreview"
                  alt="Processed preview"
                  class="w-32 max-h-32 sm:w-40 sm:max-h-40 object-contain rounded-lg border border-dashed border-default"
                />
              </div>

              <!-- Raw file preview (before background removal) -->
              <img
                v-else-if="imagePreview"
                :src="imagePreview"
                alt="Preview"
                class="w-32 max-h-32 sm:w-40 sm:max-h-40 object-contain rounded-lg"
              />

              <!-- Background removal button -->
              <UButton
                v-if="selectedImage && !processedPreview"
                variant="solid"
                color="neutral"
                :loading="processingPreview"
                :disabled="processingPreview"
                @click="previewProcessed"
              >
                {{
                  processingPreview
                    ? t('products.processingPreview')
                    : t('products.previewBgRemoval')
                }}
              </UButton>

              <!-- Remove background toggle -->
              <USwitch
                v-if="selectedImage"
                v-model="removeBackground"
                :label="t('products.removeBackground')"
                size="sm"
                color="success"
              />

              <!-- File input -->
              <div class="w-full max-w-xs max-md:max-w-none">
                <UFormField :label="t('products.image')" name="image">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    class="block w-full text-sm max-md:text-base text-muted max-md:file:h-12 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-accented file:text-highlighted hover:file:bg-(--pili-pressed) cursor-pointer"
                    @change="handleFileChange"
                  />
                </UFormField>
              </div>
            </div>
          </div>
        </div>

        <!-- Row 2: Translations (3 columns) -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            v-for="translation in editedProduct.translations"
            :key="translation.language"
            class="space-y-2 sm:space-y-3"
          >
            <UFormField
              :label="translation.language.toUpperCase() + ' ' + t('common.name')"
              :name="`translation-${translation.language}-name`"
              :required="translation.language === 'fr'"
            >
              <UInput :ui="inputUi" v-model="translation.name" :placeholder="t('common.name')" />
            </UFormField>

            <UFormField
              :label="translation.language.toUpperCase() + ' ' + t('common.description')"
              :name="`translation-${translation.language}-description`"
            >
              <UTextarea
                :ui="textareaUi"
                v-model="translation.description"
                :placeholder="t('common.description')"
                :rows="2"
                :class="isMobile ? '' : 'sm:!min-h-[4.5rem]'"
              />
            </UFormField>
          </div>
        </div>

        <!-- Row 3: Toggles -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <button
            type="button"
            role="switch"
            :aria-checked="editedProduct.isVisible"
            class="flex items-center justify-between gap-3 rounded-lg border border-default bg-elevated px-3 py-2 cursor-pointer hover:bg-accented transition-colors w-full min-h-12 text-left"
            @click="editedProduct.isVisible = !editedProduct.isVisible"
          >
            <span class="text-sm">{{ t('common.visible') }}</span>
            <PiliSwitch :model-value="editedProduct.isVisible" size="md" presentational />
          </button>
          <button
            type="button"
            role="switch"
            :aria-checked="editedProduct.isAvailable"
            class="flex items-center justify-between gap-3 rounded-lg border border-default bg-elevated px-3 py-2 cursor-pointer hover:bg-accented transition-colors w-full min-h-12 text-left"
            @click="editedProduct.isAvailable = !editedProduct.isAvailable"
          >
            <span class="text-sm">{{ t('common.available') }}</span>
            <PiliSwitch :model-value="editedProduct.isAvailable" size="md" presentational />
          </button>
          <button
            type="button"
            role="switch"
            :aria-checked="editedProduct.isDiscountable"
            class="flex items-center justify-between gap-3 rounded-lg border border-default bg-elevated px-3 py-2 cursor-pointer hover:bg-accented transition-colors w-full min-h-12 text-left"
            @click="editedProduct.isDiscountable = !editedProduct.isDiscountable"
          >
            <span class="text-sm">{{ t('products.discountable') }}</span>
            <PiliSwitch :model-value="editedProduct.isDiscountable" size="md" presentational />
          </button>
          <button
            type="button"
            role="switch"
            :aria-checked="editedProduct.isHalal"
            class="flex items-center justify-between gap-3 rounded-lg border border-default bg-elevated px-3 py-2 cursor-pointer hover:bg-accented transition-colors w-full min-h-12 text-left"
            @click="editedProduct.isHalal = !editedProduct.isHalal"
          >
            <span class="text-sm">{{ t('products.halal') }}</span>
            <PiliSwitch :model-value="editedProduct.isHalal" size="md" presentational />
          </button>
          <button
            type="button"
            role="switch"
            :aria-checked="editedProduct.isVegetarian"
            class="flex items-center justify-between gap-3 rounded-lg border border-default bg-elevated px-3 py-2 cursor-pointer hover:bg-accented transition-colors w-full min-h-12 text-left"
            @click="editedProduct.isVegetarian = !editedProduct.isVegetarian"
          >
            <span class="text-sm">{{ t('products.vegetarian') }}</span>
            <PiliSwitch :model-value="editedProduct.isVegetarian" size="md" presentational />
          </button>
          <button
            type="button"
            role="switch"
            :aria-checked="editedProduct.isSpicy"
            class="flex items-center justify-between gap-3 rounded-lg border border-default bg-elevated px-3 py-2 cursor-pointer hover:bg-accented transition-colors w-full min-h-12 text-left"
            @click="editedProduct.isSpicy = !editedProduct.isSpicy"
          >
            <span class="text-sm">{{ t('products.spicy') }}</span>
            <PiliSwitch :model-value="editedProduct.isSpicy" size="md" presentational />
          </button>
          <button
            type="button"
            role="switch"
            :aria-checked="editedProduct.isLunchOnly"
            class="flex items-center justify-between gap-3 rounded-lg border border-default bg-elevated px-3 py-2 cursor-pointer hover:bg-accented transition-colors w-full min-h-12 text-left"
            @click="editedProduct.isLunchOnly = !editedProduct.isLunchOnly"
          >
            <span class="text-sm">{{ t('products.lunchOnly') }}</span>
            <PiliSwitch :model-value="editedProduct.isLunchOnly" size="md" presentational />
          </button>
        </div>

        <!-- Row 4: Product Choice Groups (edit mode only) -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-medium">{{ t('products.choices.title') }}</h3>
            <UButton icon="i-lucide-plus" size="xs" variant="outline" @click="addNewChoiceGroup">
              {{ t('products.choices.groupAdd') }}
            </UButton>
          </div>

          <div v-if="editedChoiceGroups.length === 0" class="text-sm text-muted italic">
            {{ t('products.choices.none') }}
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="(group, gIdx) in editedChoiceGroups"
              :key="group.id || `group-new-${gIdx}`"
              class="border border-default bg-elevated rounded-[14px] p-3 space-y-3"
            >
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold text-muted">
                  {{
                    group.id
                      ? t('products.choices.groupLabel', { index: gIdx + 1 })
                      : t('products.choices.groupNew')
                  }}
                </span>
                <UButton
                  icon="i-lucide-trash-2"
                  size="xs"
                  color="error"
                  variant="outline"
                  @click="removeChoiceGroup(gIdx)"
                />
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                <UFormField
                  :label="t('products.choices.minSelections')"
                  :name="`group-${gIdx}-min`"
                >
                  <UInput
                    :ui="monoInputUi"
                    v-model.number="group.minSelections"
                    type="number"
                    min="0"
                    placeholder="1"
                  />
                </UFormField>
                <UFormField
                  :label="t('products.choices.maxSelections')"
                  :name="`group-${gIdx}-max`"
                >
                  <UInput
                    :ui="monoInputUi"
                    v-model.number="group.maxSelections"
                    type="number"
                    min="1"
                    placeholder="1"
                  />
                </UFormField>
                <UFormField :label="t('products.choices.sortOrder')" :name="`group-${gIdx}-sort`">
                  <UInput
                    :ui="monoInputUi"
                    v-model.number="group.sortOrder"
                    type="number"
                    placeholder="0"
                  />
                </UFormField>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                <UFormField
                  v-for="lang in languages"
                  :key="lang"
                  :label="`${lang.toUpperCase()} ${t('products.choices.groupName')}`"
                  :name="`group-${gIdx}-${lang}`"
                >
                  <UInput
                    :ui="inputUi"
                    v-model="getGroupTranslation(group, lang).name"
                    :placeholder="t('common.name')"
                  />
                </UFormField>
              </div>

              <div class="border-t border-default pt-3 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium text-muted">{{
                    t('products.choices.choicesTitle')
                  }}</span>
                  <UButton
                    icon="i-lucide-plus"
                    size="xs"
                    variant="outline"
                    @click="addNewChoice(gIdx)"
                  >
                    {{ t('products.choices.add') }}
                  </UButton>
                </div>

                <div v-if="group.choices.length === 0" class="text-xs text-muted italic">
                  {{ t('products.choices.none') }}
                </div>

                <div
                  v-for="(choice, cIdx) in group.choices"
                  :key="choice.id || `new-${gIdx}-${cIdx}`"
                  class="border border-default bg-accented rounded-lg p-2 space-y-2"
                >
                  <div class="flex items-center justify-between">
                    <span class="text-xs text-muted">{{
                      choice.id ? `#${cIdx + 1}` : t('products.choices.new')
                    }}</span>
                    <UButton
                      icon="i-lucide-trash-2"
                      size="xs"
                      color="error"
                      variant="outline"
                      @click="removeChoice(gIdx, cIdx)"
                    />
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <UFormField
                      :label="t('products.choices.priceModifier')"
                      :name="`choice-${gIdx}-${cIdx}-price`"
                    >
                      <UInput
                        :ui="monoInputUi"
                        v-model="choice.priceModifier"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                      />
                    </UFormField>
                    <UFormField
                      :label="t('products.choices.sortOrder')"
                      :name="`choice-${gIdx}-${cIdx}-sort`"
                    >
                      <UInput
                        :ui="monoInputUi"
                        v-model.number="choice.sortOrder"
                        type="number"
                        placeholder="0"
                      />
                    </UFormField>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <UFormField
                      v-for="lang in languages"
                      :key="lang"
                      :label="`${lang.toUpperCase()} ${t('common.name')}`"
                      :name="`choice-${gIdx}-${cIdx}-${lang}`"
                    >
                      <UInput
                        :ui="inputUi"
                        v-model="getChoiceTranslation(choice, lang).name"
                        :placeholder="t('common.name')"
                      />
                    </UFormField>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Validation Errors -->
        <div
          v-if="validationErrors.length > 0"
          class="rounded-lg border border-error bg-elevated p-3"
        >
          <ul class="list-disc list-inside text-sm text-error space-y-1">
            <li v-for="(error, index) in validationErrors" :key="index">{{ error }}</li>
          </ul>
        </div>
      </div>
    </template>

    <template #footer>
      <UButton
        :variant="isMobile ? 'solid' : 'ghost'"
        color="neutral"
        class="max-md:flex-1 max-md:h-14 max-md:justify-center max-md:text-base max-md:font-bold"
        @click="closeDialog"
      >
        {{ t('common.cancel') }}
      </UButton>
      <UButton
        color="primary"
        class="max-md:flex-[2] max-md:h-14 max-md:justify-center max-md:text-base max-md:font-bold"
        @click="saveChanges"
      >
        {{ saveLabel }}
      </UButton>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type {
  ChoiceTranslation,
  CreateProductInput,
  Product,
  ProductChoice,
  ProductChoiceGroup,
  Translation,
  TranslationInput,
  UpdateProductInput,
  UpdateProductRequest,
} from '~/types'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useCategoriesStore } from '~/stores/categories'
import { splitEmptyChoiceGroups } from '~/utils/choiceGroups'
import { useI18n } from 'vue-i18n'

// Props and emits definition.
const {
  product = undefined,
  mode = 'create',
  onCreate = undefined,
} = defineProps<{
  product?: Product
  mode?: 'create' | 'edit'
  onCreate?: (input: CreateProductInput) => Promise<Product | null>
}>()

const emit = defineEmits<{
  update: [updatedProduct: UpdateProductRequest]
  create: [newProduct: CreateProductInput]
  close: []
}>()

const { t, locale } = useI18n()
const isMobile = useIsMobile()
const toast = useToast()

// Languages used for translations.
const languages = ['fr', 'en', 'zh', 'nl']

// Pili inputs: Ardoise fill, 1px border, Brume border on focus, no ring/glow.
// Below md the fields are phone-sized: full width, 48px tall, 16px text (no iOS zoom).
const fieldBase =
  'bg-accented ring-0 border border-default focus-visible:ring-0 focus-visible:border-inverted'
const inputUi = computed(() => ({
  root: isMobile.value ? 'w-full' : '',
  base: isMobile.value ? `${fieldBase} h-12 text-base` : fieldBase,
}))
const monoInputUi = computed(() => ({
  root: inputUi.value.root,
  base: `${inputUi.value.base} font-mono tabular-nums`,
}))
const textareaUi = computed(() => ({
  root: isMobile.value ? 'w-full' : '',
  base: isMobile.value ? `${fieldBase} min-h-24 text-base` : fieldBase,
}))
const selectMenuUi = computed(() => ({ ...inputUi.value, content: 'min-w-[200px]' }))

// Create a copy of an existing product with exactly the languages we need.
const createProductCopy = (sourceProduct: Product): CreateProductInput => {
  const categoryId = sourceProduct.category?.id || ''
  const translations: TranslationInput[] = languages.map((lang) => {
    const existing = sourceProduct.translations.find((tr) => tr.language === lang)
    return existing
      ? { language: lang, name: existing.name, description: existing.description ?? '' }
      : { language: lang, name: '', description: '' }
  })
  return {
    categoryId,
    code: sourceProduct.code ?? undefined,
    isAvailable: sourceProduct.isAvailable,
    isDiscountable: sourceProduct.isDiscountable,
    isHalal: sourceProduct.isHalal,
    isLunchOnly: sourceProduct.isLunchOnly,
    isSpicy: sourceProduct.isSpicy,
    isVegetarian: sourceProduct.isVegetarian,
    isVisible: sourceProduct.isVisible,
    pieceCount: sourceProduct.pieceCount ?? undefined,
    price: sourceProduct.price,
    vatCategory: sourceProduct.vatCategory ?? 'food',
    translations,
  }
}

// Create a default product for create mode.
const createDefaultProduct = (): CreateProductInput => ({
  categoryId: '',
  code: undefined,
  isAvailable: false,
  isDiscountable: true,
  isHalal: false,
  isLunchOnly: false,
  isSpicy: false,
  isVegetarian: false,
  isVisible: false,
  pieceCount: undefined,
  price: '',
  vatCategory: 'food',
  translations: languages.map((language) => ({ language, name: '', description: '' })),
})

// VAT category options (Belgian SCE 2.0 classification).
// The concrete rate depends on the order service type - displayed as helper text.
const vatCategoryOptions = computed(() => [
  { value: 'food', label: t('products.vatCategory.options.food') },
  { value: 'beverage', label: t('products.vatCategory.options.beverage') },
  { value: 'zero_rated', label: t('products.vatCategory.options.zeroRated') },
  { value: 'out_of_scope', label: t('products.vatCategory.options.outOfScope') },
])

// Initialize the edited product based on mode.
const editedProduct = ref<CreateProductInput>(
  mode === 'create' || !product ? createDefaultProduct() : createProductCopy(product),
)

// In edit mode, update the copy if the prop changes.
if (mode !== 'create') {
  watch(
    () => product,
    (newVal) => {
      if (newVal) {
        editedProduct.value = createProductCopy(newVal)
      }
    },
  )
}

const validationErrors = ref<string[]>([])
const dialog = ref(true)

// ---- Product Choices Management ----
interface EditableChoice {
  id?: string
  priceModifier: string
  sortOrder: number
  translations: ChoiceTranslation[]
  _deleted?: boolean
  isNew?: boolean
}

interface EditableChoiceGroup {
  id?: string
  minSelections: number
  maxSelections: number
  sortOrder: number
  translations: ChoiceTranslation[]
  choices: EditableChoice[]
  _deleted?: boolean
  isNew?: boolean
}

const editedChoiceGroups = ref<EditableChoiceGroup[]>(
  product?.choiceGroups?.map((group) => ({
    id: group.id,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    sortOrder: group.sortOrder,
    translations: languages.map((lang) => {
      const existing = group.translations?.find((tr) => tr.locale === lang)
      return { locale: lang, name: existing?.name || '' }
    }),
    choices: (group.choices ?? []).map((choice) => ({
      id: choice.id,
      priceModifier: choice.priceModifier,
      sortOrder: choice.sortOrder,
      translations: languages.map((lang) => {
        const existing = choice.translations?.find((tr) => tr.locale === lang)
        return { locale: lang, name: existing?.name || '' }
      }),
    })),
  })) ?? [],
)

if (editedChoiceGroups.value.length === 0 && (product?.choices?.length ?? 0) > 0) {
  editedChoiceGroups.value.push({
    minSelections: 1,
    maxSelections: 1,
    sortOrder: 0,
    translations: languages.map((lang) => ({ locale: lang, name: '' })),
    choices: product!.choices.map((choice) => ({
      id: choice.id,
      priceModifier: choice.priceModifier,
      sortOrder: choice.sortOrder,
      translations: languages.map((lang) => {
        const existing = choice.translations?.find((tr) => tr.locale === lang)
        return { locale: lang, name: existing?.name || '' }
      }),
    })),
  })
}

const getGroupTranslation = (group: EditableChoiceGroup, lang: string) => {
  let translation = group.translations.find((tr) => tr.locale === lang)
  if (!translation) {
    translation = { locale: lang, name: '' }
    group.translations.push(translation)
  }
  return translation
}

const getChoiceTranslation = (choice: EditableChoice, lang: string) => {
  let translation = choice.translations.find((tr) => tr.locale === lang)
  if (!translation) {
    translation = { locale: lang, name: '' }
    choice.translations.push(translation)
  }
  return translation
}

const ensureFrenchChoiceTranslations = (translations: ChoiceTranslation[]): ChoiceTranslation[] => {
  const nonEmpty = translations.filter((tr) => tr.name.trim() !== '')
  const hasFrench = nonEmpty.some((tr) => tr.locale === 'fr')
  if (hasFrench) return nonEmpty

  const fallback =
    translations.find((tr) => tr.locale === 'fr')?.name.trim() || nonEmpty[0]?.name.trim() || ''
  if (fallback === '') return nonEmpty

  return [{ locale: 'fr', name: fallback }, ...nonEmpty.filter((tr) => tr.locale !== 'fr')]
}

const normalizeChoiceOrdering = () => {
  editedChoiceGroups.value.forEach((group, groupIndex) => {
    group.sortOrder = groupIndex
    group.choices.forEach((choice, choiceIndex) => {
      choice.sortOrder = choiceIndex
    })
  })
}

const addNewChoiceGroup = () => {
  editedChoiceGroups.value.push({
    minSelections: 1,
    maxSelections: 1,
    sortOrder: editedChoiceGroups.value.length,
    translations: languages.map((lang) => ({ locale: lang, name: '' })),
    choices: [],
    isNew: true,
  })
  normalizeChoiceOrdering()
}

const addNewChoice = (groupIdx: number) => {
  const group = editedChoiceGroups.value[groupIdx]
  if (!group) return
  group.choices.push({
    priceModifier: '0',
    sortOrder: group.choices.length,
    translations: languages.map((lang) => ({ locale: lang, name: '' })),
    isNew: true,
  })
  normalizeChoiceOrdering()
}

// Removals stay local until Save, so closing the dialog never leaves a half-edited group (e.g. emptied) behind.
const removedChoiceGroupIds: string[] = []
const removedChoiceIds: string[] = []

const removeChoiceGroup = (groupIdx: number) => {
  const group = editedChoiceGroups.value[groupIdx]
  if (!group) return

  if (group.id) removedChoiceGroupIds.push(group.id)
  editedChoiceGroups.value.splice(groupIdx, 1)
  normalizeChoiceOrdering()
}

const removeChoice = (groupIdx: number, choiceIdx: number) => {
  const group = editedChoiceGroups.value[groupIdx]
  const choice = group?.choices[choiceIdx]
  if (!group || !choice) return

  if (choice.id) removedChoiceIds.push(choice.id)
  group.choices.splice(choiceIdx, 1)
  normalizeChoiceOrdering()
}

const saveChoices = async (productId: string) => {
  if (!product?.id) return

  // A group left without choices is deleted rather than saved (see utils/choiceGroups.ts).
  const { kept, emptyGroupIds } = splitEmptyChoiceGroups(editedChoiceGroups.value)
  editedChoiceGroups.value = kept
  normalizeChoiceOrdering()

  const DELETE_CHOICE = /* GraphQL */ `
    mutation ($id: ID!) {
      deleteProductChoice(id: $id)
    }
  `
  const DELETE_GROUP = /* GraphQL */ `
    mutation ($id: ID!) {
      deleteProductChoiceGroup(id: $id)
    }
  `
  while (removedChoiceIds.length > 0) {
    const { mutate } = useGqlMutation<{ deleteProductChoice: boolean }>(DELETE_CHOICE)
    await mutate({ id: removedChoiceIds[0] })
    removedChoiceIds.shift()
  }
  removedChoiceGroupIds.push(...emptyGroupIds)
  while (removedChoiceGroupIds.length > 0) {
    const { mutate } = useGqlMutation<{ deleteProductChoiceGroup: boolean }>(DELETE_GROUP)
    await mutate({ id: removedChoiceGroupIds[0] })
    removedChoiceGroupIds.shift()
  }

  const CREATE_GROUP = /* GraphQL */ `
    mutation ($input: CreateProductChoiceGroupInput!) {
      createProductChoiceGroup(input: $input) {
        id
        productId
        minSelections
        maxSelections
        sortOrder
        name
        translations {
          locale
          name
        }
      }
    }
  `
  const UPDATE_GROUP = /* GraphQL */ `
    mutation ($id: ID!, $input: UpdateProductChoiceGroupInput!) {
      updateProductChoiceGroup(id: $id, input: $input) {
        id
        productId
        minSelections
        maxSelections
        sortOrder
        name
        translations {
          locale
          name
        }
      }
    }
  `

  const CREATE_CHOICE = /* GraphQL */ `
    mutation ($input: CreateProductChoiceInput!) {
      createProductChoice(input: $input) {
        id
        productId
        choiceGroupId
        priceModifier
        sortOrder
        name
        translations {
          locale
          name
        }
      }
    }
  `
  const UPDATE_CHOICE = /* GraphQL */ `
    mutation ($id: ID!, $input: UpdateProductChoiceInput!) {
      updateProductChoice(id: $id, input: $input) {
        id
        productId
        choiceGroupId
        priceModifier
        sortOrder
        name
        translations {
          locale
          name
        }
      }
    }
  `

  for (const group of editedChoiceGroups.value) {
    let groupId = group.id

    if (group.isNew || !groupId) {
      const { mutate } = useGqlMutation<{ createProductChoiceGroup: ProductChoiceGroup }>(
        CREATE_GROUP,
      )
      const created = await mutate({
        input: {
          productId,
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
          sortOrder: group.sortOrder,
          translations: ensureFrenchChoiceTranslations(group.translations),
        },
      })
      groupId = created.createProductChoiceGroup.id
      group.id = groupId
      group.isNew = false
    } else {
      const { mutate } = useGqlMutation<{ updateProductChoiceGroup: ProductChoiceGroup }>(
        UPDATE_GROUP,
      )
      await mutate({
        id: groupId,
        input: {
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
          sortOrder: group.sortOrder,
          translations: ensureFrenchChoiceTranslations(group.translations),
        },
      })
    }

    for (const choice of group.choices) {
      if (choice.isNew) {
        const { mutate } = useGqlMutation<{ createProductChoice: ProductChoice }>(CREATE_CHOICE)
        await mutate({
          input: {
            choiceGroupId: groupId,
            priceModifier: choice.priceModifier,
            sortOrder: choice.sortOrder,
            translations: ensureFrenchChoiceTranslations(choice.translations),
          },
        })
      } else if (choice.id) {
        const { mutate } = useGqlMutation<{ updateProductChoice: ProductChoice }>(UPDATE_CHOICE)
        await mutate({
          id: choice.id,
          input: {
            priceModifier: choice.priceModifier,
            sortOrder: choice.sortOrder,
            translations: ensureFrenchChoiceTranslations(choice.translations),
          },
        })
      }
    }
  }
}

// Watch dialog state and emit close when it becomes false
watch(dialog, (newValue) => {
  if (!newValue) {
    emit('close')
  }
})

const categoryStore = useCategoriesStore()
const categories = computed(() => categoryStore.getCategories(locale.value))

// Localized categories with the correct language name
const localizedCategories = computed(() =>
  categories.value.map((cat) => {
    // Find translation for current locale
    const translation = cat.translations?.find((tr) => tr.language === locale.value)
    // Use translated name if available, otherwise fallback to default
    const localizedName = translation?.name || cat.name
    return {
      id: cat.id,
      name: localizedName,
      order: cat.order,
      translations: cat.translations,
    }
  }),
)

const closeDialog = () => {
  dialog.value = false
}

const LANG_LABELS: Record<string, string> = { fr: 'FR', en: 'EN', zh: 'ZH', nl: 'NL' }
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_IMAGE_SIZE = 50 * 1024 * 1024 // 50 MB
const CODE_REGEX = /^[A-Z]+\d+$/u

const saveChanges = async () => {
  validationErrors.value = []

  // Category required
  if (!editedProduct.value.categoryId || editedProduct.value.categoryId.trim() === '') {
    validationErrors.value.push(t('validation.categoryRequired'))
  }

  // French name required
  const frTranslations = editedProduct.value.translations ?? []
  const frTranslation = frTranslations.find((tr) => tr.language === 'fr')
  if (!frTranslation?.name || frTranslation.name.trim() === '') {
    validationErrors.value.push(t('validation.frenchNameRequired'))
  }

  // Price required and positive
  if (!editedProduct.value.price || editedProduct.value.price === '') {
    validationErrors.value.push(t('validation.priceRequired'))
  } else {
    const priceNum = parseFloat(String(editedProduct.value.price).replace(',', '.'))
    if (isNaN(priceNum) || priceNum <= 0) {
      validationErrors.value.push(t('validation.pricePositive'))
    }
  }

  // VAT category required
  const validVatCategories = ['food', 'beverage', 'zero_rated', 'out_of_scope']
  if (
    !editedProduct.value.vatCategory ||
    !validVatCategories.includes(editedProduct.value.vatCategory)
  ) {
    validationErrors.value.push(t('validation.vatCategoryRequired'))
  }

  // Description max 500 chars per language
  for (const tr of editedProduct.value.translations ?? []) {
    if (tr.description && tr.description.length > 500) {
      validationErrors.value.push(
        t('validation.descriptionTooLong', { lang: LANG_LABELS[tr.language] || tr.language }),
      )
    }
  }

  // Image validation
  if (selectedImage.value) {
    if (selectedImage.value.size > MAX_IMAGE_SIZE) {
      validationErrors.value.push(t('validation.imageTooLarge'))
    }
    if (!ALLOWED_IMAGE_TYPES.includes(selectedImage.value.type)) {
      validationErrors.value.push(t('validation.imageInvalidType'))
    }
  }

  // Code format (optional field)
  if (editedProduct.value.code && editedProduct.value.code.trim() !== '') {
    if (!CODE_REGEX.test(editedProduct.value.code.trim())) {
      validationErrors.value.push(t('validation.codeFormat'))
    }
  }

  // Piece count: positive integer (optional field)
  const rawPieceCount = editedProduct.value.pieceCount
  if (
    rawPieceCount !== null &&
    rawPieceCount !== undefined &&
    String(rawPieceCount).trim() !== ''
  ) {
    const pc = Number(rawPieceCount)
    if (!Number.isInteger(pc) || pc <= 0) {
      validationErrors.value.push(t('validation.pieceCountPositive'))
    }
  }

  // Choice validation (applies to both create and edit modes)
  for (let gIdx = 0; gIdx < editedChoiceGroups.value.length; gIdx++) {
    const group = editedChoiceGroups.value[gIdx]!
    const hasGroupName = group.translations.some((tr) => tr.name.trim() !== '')
    if (!hasGroupName) {
      validationErrors.value.push(t('validation.choiceGroupNameRequired', { index: gIdx + 1 }))
    }
    if (
      group.minSelections < 0 ||
      group.maxSelections < 1 ||
      group.minSelections > group.maxSelections
    ) {
      validationErrors.value.push(t('validation.choiceGroupRangeInvalid', { index: gIdx + 1 }))
    }

    for (let cIdx = 0; cIdx < group.choices.length; cIdx++) {
      const choice = group.choices[cIdx]!
      const hasAnyName = choice.translations.some((tr) => tr.name.trim() !== '')
      if (!hasAnyName) {
        validationErrors.value.push(t('validation.choiceNameRequired', { index: cIdx + 1 }))
      }
      const pm = parseFloat(String(choice.priceModifier).replace(',', '.'))
      if (isNaN(pm)) {
        validationErrors.value.push(t('validation.choicePriceRequired', { index: cIdx + 1 }))
      }
    }
  }

  if (validationErrors.value.length > 0) {
    return
  }

  // Normalize nullable fields: empty strings / invalid numbers → null
  const normalizeCode = (v: unknown): string | null => {
    if (typeof v !== 'string') return null
    const trimmed = v.trim()
    return trimmed === '' ? null : trimmed
  }
  const normalizePieceCount = (v: unknown): number | null => {
    if (v === null || v === undefined || String(v).trim() === '') return null
    const n = Number(v)
    return Number.isInteger(n) ? n : null
  }

  if (mode === 'create') {
    const createProductInput: CreateProductInput = {
      ...(editedProduct.value as CreateProductInput),
      code: normalizeCode(editedProduct.value.code) ?? undefined,
      pieceCount: normalizePieceCount(editedProduct.value.pieceCount) ?? undefined,
    }

    if (selectedImage.value) {
      createProductInput.image = selectedImage.value
      createProductInput.removeBackground = removeBackground.value
    }

    if (onCreate) {
      const created = await onCreate(createProductInput)
      if (!created) return

      if (editedChoiceGroups.value.length > 0) {
        try {
          await saveChoices(created.id)
        } catch {
          validationErrors.value.push(t('validation.choiceSaveFailed'))
          return
        }
      }
      emit('close')
    } else {
      emit('create', createProductInput)
    }
  } else {
    if (!product?.id) return

    // Save choices first
    try {
      await saveChoices(product.id)
    } catch {
      validationErrors.value.push(t('validation.choiceSaveFailed'))
      return
    }

    const updateProductInput: UpdateProductInput = {
      ...(editedProduct.value as UpdateProductInput),
      code: normalizeCode(editedProduct.value.code),
      pieceCount: normalizePieceCount(editedProduct.value.pieceCount),
    }

    if (selectedImage.value) {
      updateProductInput.image = selectedImage.value
      updateProductInput.removeBackground = removeBackground.value
    }

    const { categoryId, ...rest } = updateProductInput as any
    const inputForApi = categoryId ? { ...rest, categoryID: categoryId } : rest
    const updateProductRequest: UpdateProductRequest = {
      id: product!.id,
      input: inputForApi as UpdateProductInput,
    }

    emit('update', updateProductRequest)
  }
}

const dialogTitle = computed(() => (mode === 'create' ? t('products.add') : t('products.edit')))
const saveLabel = computed(() => (mode === 'create' ? t('common.create') : t('common.save')))

// ----- Image Preview / Upload Section -----
const config = useRuntimeConfig()
// Compute the image URL based on the product ID.
const imageUrl = computed(() =>
  product?.id ? `${config.public.s3bucketUrl}/images/thumbnails/${product.id}.png` : '',
)

// Flag indicating if the image exists.
const hasImage = ref(false)
// Reactive property to hold the file if the user uploads one.
const selectedImage = ref<File | null>(null)
const imagePreview = ref<string | null>(null)
const processedPreview = ref<string | null>(null)
const processingPreview = ref(false)
const removeBackground = ref(false)

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    selectedImage.value = file
    removeBackground.value = false
    if (processedPreview.value) {
      URL.revokeObjectURL(processedPreview.value)
      processedPreview.value = null
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      imagePreview.value = e.target?.result as string
    }
    reader.readAsDataURL(file)
  } else {
    selectedImage.value = null
    imagePreview.value = null
  }
}

const previewProcessed = async () => {
  if (!selectedImage.value) return
  processingPreview.value = true
  try {
    const form = new FormData()
    form.append('image', selectedImage.value, selectedImage.value.name)

    const headers: Record<string, string> = {}
    const { useOidc } = await import('~/composables/useOidc')
    const { getAccessToken } = useOidc()
    const token = await getAccessToken()
    if (token) headers['Authorization'] = `Bearer ${token}`

    const response = await fetch(`${config.public.api}/images/preview`, {
      method: 'POST',
      body: form,
      headers,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const blob = await response.blob()
    if (processedPreview.value) URL.revokeObjectURL(processedPreview.value)
    processedPreview.value = URL.createObjectURL(blob)
    removeBackground.value = true
  } catch {
    toast.add({ title: t('products.previewFailed'), color: 'error' })
  } finally {
    processingPreview.value = false
  }
}

watch(selectedImage, (file) => {
  if (!file) {
    imagePreview.value = null
    removeBackground.value = false
    if (processedPreview.value) {
      URL.revokeObjectURL(processedPreview.value)
      processedPreview.value = null
    }
  }
})

// Helper function to check if an image exists at a given URL.
const checkImageExists = (url: string) => {
  const img = new Image()
  img.src = url
  img.onload = () => {
    hasImage.value = true
  }
  img.onerror = () => {
    hasImage.value = false
  }
}

onMounted(() => {
  if (imageUrl.value) {
    checkImageExists(imageUrl.value)
  }
})

// Re-check the image whenever the URL changes.
watch(imageUrl, (newUrl) => {
  if (newUrl) {
    checkImageExists(newUrl)
  } else {
    hasImage.value = false
  }
})

// Remove the current image preview so that the file input appears.
const removeImage = () => {
  hasImage.value = false
  selectedImage.value = null
  if (processedPreview.value) {
    URL.revokeObjectURL(processedPreview.value)
    processedPreview.value = null
  }
}

onUnmounted(() => {
  if (processedPreview.value) URL.revokeObjectURL(processedPreview.value)
})
</script>

<style scoped>
/* Remove the spinner arrows in WebKit browsers */
input[type='number']::-webkit-inner-spin-button,
input[type='number']::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Remove the spinner arrows in Firefox */
input[type='number'] {
  -moz-appearance: textfield;
}
</style>

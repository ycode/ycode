import type { Layer, Page, Translation, TranslationContentType, Locale, LocaleOption, CollectionField, Component, ComponentVariable, DynamicTextVariable, DynamicRichTextVariable, StringAssetId, FieldVariable } from '@/types';
import { getLayerIcon, getLayerName } from '@/lib/layer-display-utils';
import {
  buildLayerTranslationKey,
  getTranslationByKey,
  hasValidTranslationValue,
  getTranslationValue,
} from '@/lib/locale-runtime';
import { createDynamicTextVariable, createDynamicRichTextVariable, createDynamicRichTextVariableFromPlainText, createAssetVariable } from '@/lib/variable-utils';
import { castValue } from '@/lib/collection-utils';
import { tiptapDocHasFormatting, tiptapDocToCanonicalString, hasVariableNode, hasAnyTextOrVariable } from '@/lib/tiptap-utils';
import { stringToTiptapContent } from '@/lib/text-format-utils';
import { isRichTextLayer } from '@/lib/layer-utils';
import { looksLikeFormattedHtml } from '@/lib/translation-classification';
import type { IconProps } from '@/components/ui/icon';

// Re-exports for back-compat — runtime translation helpers now live in
// `lib/locale-runtime.ts` (template-free) so the public renderer can import
// them without dragging in the builder-only translatable-item extractors.
export {
  getTranslatableKey,
  buildLayerTranslationKey,
  getTranslationByKey,
  hasValidTranslationValue,
  getTranslationValue,
  getTranslatedAssetId,
  getTranslatedText,
} from '@/lib/locale-runtime';

/**
 * Supported locales with their metadata (ISO 639-1 codes)
 * Sorted alphabetically by english label
 */
export const LOCALES: LocaleOption[] = [
  { code: 'ab', label: 'Abkhaz', native_label: 'аҧсуа' },
  { code: 'aa', label: 'Afar', native_label: 'Afaraf' },
  { code: 'af', label: 'Afrikaans', native_label: 'Afrikaans' },
  { code: 'ak', label: 'Akan', native_label: 'Akan' },
  { code: 'sq', label: 'Albanian', native_label: 'Shqip' },
  { code: 'am', label: 'Amharic', native_label: 'አማርኛ' },
  { code: 'ar', label: 'Arabic', native_label: 'العربية', rtl: true },
  { code: 'ar-eg', label: 'Arabic (Egypt)', native_label: 'العربية (مصر)', rtl: true },
  { code: 'ar-lb', label: 'Arabic (Lebanon)', native_label: 'العربية (لبنان)', rtl: true },
  { code: 'ar-ma', label: 'Arabic (Morocco)', native_label: 'العربية (المغرب)', rtl: true },
  { code: 'ar-sa', label: 'Arabic (Saudi Arabia)', native_label: 'العربية (السعودية)', rtl: true },
  { code: 'an', label: 'Aragonese', native_label: 'Aragonés' },
  { code: 'hy', label: 'Armenian', native_label: 'Հայերեն' },
  { code: 'as', label: 'Assamese', native_label: 'অসমীয়া' },
  { code: 'av', label: 'Avaric', native_label: 'авар мацӀ' },
  { code: 'ae', label: 'Avestan', native_label: 'avesta' },
  { code: 'ay', label: 'Aymara', native_label: 'aymar aru' },
  { code: 'az', label: 'Azerbaijani', native_label: 'azərbaycan dili' },
  { code: 'bm', label: 'Bambara', native_label: 'bamanankan' },
  { code: 'ba', label: 'Bashkir', native_label: 'башҡорт теле' },
  { code: 'eu', label: 'Basque', native_label: 'Euskara' },
  { code: 'be', label: 'Belarusian', native_label: 'Беларуская' },
  { code: 'bn', label: 'Bengali', native_label: 'বাংলা' },
  { code: 'bh', label: 'Bihari', native_label: 'भोजपुरी' },
  { code: 'bi', label: 'Bislama', native_label: 'Bislama' },
  { code: 'bs', label: 'Bosnian', native_label: 'Bosanski' },
  { code: 'br', label: 'Breton', native_label: 'Brezhoneg' },
  { code: 'bg', label: 'Bulgarian', native_label: 'Български' },
  { code: 'my', label: 'Burmese', native_label: 'ဗမာစာ' },
  { code: 'ca', label: 'Catalan', native_label: 'Català' },
  { code: 'ch', label: 'Chamorro', native_label: 'Chamoru' },
  { code: 'ce', label: 'Chechen', native_label: 'нохчийн мотт' },
  { code: 'ny', label: 'Chichewa', native_label: 'chiCheŵa' },
  { code: 'zh', label: 'Chinese', native_label: '中文' },
  { code: 'zh-hk', label: 'Chinese (Hong Kong)', native_label: '繁體中文 (香港)' },
  { code: 'zh-cn', label: 'Chinese (Simplified)', native_label: '简体中文' },
  { code: 'zh-tw', label: 'Chinese (Traditional)', native_label: '繁體中文 (台灣)' },
  { code: 'cv', label: 'Chuvash', native_label: 'чӑваш чӗлхи' },
  { code: 'kw', label: 'Cornish', native_label: 'Kernewek' },
  { code: 'co', label: 'Corsican', native_label: 'Lingua corsa' },
  { code: 'cr', label: 'Cree', native_label: 'ᓀᐦᐃᔭᐍᐏᐣ' },
  { code: 'hr', label: 'Croatian', native_label: 'Hrvatski' },
  { code: 'cs', label: 'Czech', native_label: 'Čeština' },
  { code: 'da', label: 'Danish', native_label: 'Dansk' },
  { code: 'dv', label: 'Divehi', native_label: 'ދިވެހި', rtl: true },
  { code: 'nl', label: 'Dutch', native_label: 'Nederlands' },
  { code: 'en', label: 'English', native_label: 'English' },
  { code: 'en-au', label: 'English (Australia)', native_label: 'English (Australia)' },
  { code: 'en-ca', label: 'English (Canada)', native_label: 'English (Canada)' },
  { code: 'en-in', label: 'English (India)', native_label: 'English (India)' },
  { code: 'en-nz', label: 'English (New Zealand)', native_label: 'English (New Zealand)' },
  { code: 'en-gb', label: 'English (United Kingdom)', native_label: 'English (United Kingdom)' },
  { code: 'en-us', label: 'English (United States)', native_label: 'English (United States)' },
  { code: 'eo', label: 'Esperanto', native_label: 'Esperanto' },
  { code: 'et', label: 'Estonian', native_label: 'Eesti' },
  { code: 'ee', label: 'Ewe', native_label: 'Eʋegbe' },
  { code: 'fo', label: 'Faroese', native_label: 'føroyskt' },
  { code: 'fj', label: 'Fijian', native_label: 'vosa Vakaviti' },
  { code: 'fi', label: 'Finnish', native_label: 'Suomi' },
  { code: 'fr', label: 'French', native_label: 'Français' },
  { code: 'fr-ca', label: 'French (Canada)', native_label: 'Français (Canada)' },
  { code: 'fr-fr', label: 'French (France)', native_label: 'Français (France)' },
  { code: 'fr-ch', label: 'French (Switzerland)', native_label: 'Français (Suisse)' },
  { code: 'ff', label: 'Fula', native_label: 'Fulfulde' },
  { code: 'gl', label: 'Galician', native_label: 'Galego' },
  { code: 'ka', label: 'Georgian', native_label: 'ქართული' },
  { code: 'de', label: 'German', native_label: 'Deutsch' },
  { code: 'de-at', label: 'German (Austria)', native_label: 'Deutsch (Österreich)' },
  { code: 'de-de', label: 'German (Germany)', native_label: 'Deutsch (Deutschland)' },
  { code: 'de-ch', label: 'German (Switzerland)', native_label: 'Deutsch (Schweiz)' },
  { code: 'el', label: 'Greek', native_label: 'Ελληνικά' },
  { code: 'kl', label: 'Greenlandic', native_label: 'Kalaallisut' },
  { code: 'gn', label: 'Guaraní', native_label: 'Avañeẽ' },
  { code: 'gu', label: 'Gujarati', native_label: 'ગુજરાતી' },
  { code: 'ht', label: 'Haitian Creole', native_label: 'Kreyòl ayisyen' },
  { code: 'ha', label: 'Hausa', native_label: 'Hausa' },
  { code: 'he', label: 'Hebrew', native_label: 'עברית', rtl: true },
  { code: 'hz', label: 'Herero', native_label: 'Otjiherero' },
  { code: 'hi', label: 'Hindi', native_label: 'हिन्दी' },
  { code: 'ho', label: 'Hiri Motu', native_label: 'Hiri Motu' },
  { code: 'hu', label: 'Hungarian', native_label: 'Magyar' },
  { code: 'is', label: 'Icelandic', native_label: 'Íslenska' },
  { code: 'io', label: 'Ido', native_label: 'Ido' },
  { code: 'ig', label: 'Igbo', native_label: 'Asụsụ Igbo' },
  { code: 'id', label: 'Indonesian', native_label: 'Bahasa Indonesia' },
  { code: 'ia', label: 'Interlingua', native_label: 'Interlingua' },
  { code: 'ie', label: 'Interlingue', native_label: 'Interlingue (Occidental)' },
  { code: 'iu', label: 'Inuktitut', native_label: 'ᐃᓄᒃᑎᑐᑦ' },
  { code: 'ik', label: 'Inupiaq', native_label: 'Iñupiaq' },
  { code: 'ga', label: 'Irish', native_label: 'Gaeilge' },
  { code: 'it', label: 'Italian', native_label: 'Italiano' },
  { code: 'ja', label: 'Japanese', native_label: '日本語' },
  { code: 'jv', label: 'Javanese', native_label: 'Basa Jawa' },
  { code: 'kn', label: 'Kannada', native_label: 'ಕನ್ನಡ' },
  { code: 'kr', label: 'Kanuri', native_label: 'Kanuri' },
  { code: 'ks', label: 'Kashmiri', native_label: 'كشميري', rtl: true },
  { code: 'kk', label: 'Kazakh', native_label: 'Қазақ тілі' },
  { code: 'km', label: 'Khmer', native_label: 'ភាសាខ្មែរ' },
  { code: 'ki', label: 'Kikuyu', native_label: 'Gĩkũyũ' },
  { code: 'rw', label: 'Kinyarwanda', native_label: 'Ikinyarwanda' },
  { code: 'rn', label: 'Kirundi', native_label: 'Kirundi' },
  { code: 'kv', label: 'Komi', native_label: 'коми кыв' },
  { code: 'kg', label: 'Kongo', native_label: 'KiKongo' },
  { code: 'ko', label: 'Korean', native_label: '한국어' },
  { code: 'ku', label: 'Kurdish', native_label: 'کوردی', rtl: true },
  { code: 'kj', label: 'Kwanyama', native_label: 'Kuanyama' },
  { code: 'ky', label: 'Kyrgyz', native_label: 'Кыргызча' },
  { code: 'lo', label: 'Lao', native_label: 'ພາສາລາວ' },
  { code: 'la', label: 'Latin', native_label: 'Latina' },
  { code: 'lv', label: 'Latvian', native_label: 'Latviešu' },
  { code: 'li', label: 'Limburgish', native_label: 'Limburgs' },
  { code: 'ln', label: 'Lingala', native_label: 'Lingála' },
  { code: 'lt', label: 'Lithuanian', native_label: 'Lietuvių' },
  { code: 'lu', label: 'Luba-Katanga', native_label: '' },
  { code: 'lg', label: 'Luganda', native_label: 'Luganda' },
  { code: 'lb', label: 'Luxembourgish', native_label: 'Lëtzebuergesch' },
  { code: 'mk', label: 'Macedonian', native_label: 'македонски јазик' },
  { code: 'mg', label: 'Malagasy', native_label: 'Malagasy fiteny' },
  { code: 'ms', label: 'Malay', native_label: 'Bahasa Melayu' },
  { code: 'ml', label: 'Malayalam', native_label: 'മലയാളം' },
  { code: 'mt', label: 'Maltese', native_label: 'Malti' },
  { code: 'gv', label: 'Manx', native_label: 'Gaelg' },
  { code: 'mi', label: 'Māori', native_label: 'te reo Māori' },
  { code: 'mr', label: 'Marathi', native_label: 'मराठी' },
  { code: 'mh', label: 'Marshallese', native_label: 'Kajin M̧ajeļ' },
  { code: 'mn', label: 'Mongolian', native_label: 'монгол' },
  { code: 'na', label: 'Nauru', native_label: 'Ekakairũ Naoero' },
  { code: 'nv', label: 'Navajo', native_label: 'Diné bizaad' },
  { code: 'ng', label: 'Ndonga', native_label: 'Owambo' },
  { code: 'ne', label: 'Nepali', native_label: 'नेपाली' },
  { code: 'nd', label: 'North Ndebele', native_label: 'isiNdebele' },
  { code: 'se', label: 'Northern Sami', native_label: 'Davvisámegiella' },
  { code: 'no', label: 'Norwegian', native_label: 'Norsk' },
  { code: 'nb', label: 'Norwegian Bokmål', native_label: 'Norsk bokmål' },
  { code: 'nn', label: 'Norwegian Nynorsk', native_label: 'Norsk nynorsk' },
  { code: 'ii', label: 'Nuosu', native_label: 'ꆈꌠ꒿ Nuosuhxop' },
  { code: 'oc', label: 'Occitan', native_label: 'Occitan' },
  { code: 'oj', label: 'Ojibwe', native_label: 'ᐊᓂᔑᓈᐯᒧᐎᓐ' },
  { code: 'cu', label: 'Old Church Slavonic', native_label: 'Словѣньскъ' },
  { code: 'or', label: 'Oriya', native_label: 'ଓଡ଼ିଆ' },
  { code: 'om', label: 'Oromo', native_label: 'Afaan Oromoo' },
  { code: 'os', label: 'Ossetian', native_label: 'ирон æвзаг' },
  { code: 'pi', label: 'Pāli', native_label: 'पाऴि' },
  { code: 'ps', label: 'Pashto', native_label: 'پښتو' },
  { code: 'fa', label: 'Persian', native_label: 'فارسی', rtl: true },
  { code: 'pl', label: 'Polish', native_label: 'Polski' },
  { code: 'pt', label: 'Portuguese', native_label: 'Português' },
  { code: 'pt-br', label: 'Portuguese (Brazil)', native_label: 'Português (Brasil)' },
  { code: 'pt-pt', label: 'Portuguese (Portugal)', native_label: 'Português (Portugal)' },
  { code: 'pa', label: 'Punjabi', native_label: 'ਪੰਜਾਬੀ' },
  { code: 'qu', label: 'Quechua', native_label: 'Runa Simi, Kichwa' },
  { code: 'ro', label: 'Romanian', native_label: 'Română' },
  { code: 'rm', label: 'Romansh', native_label: 'rumantsch grischun' },
  { code: 'ru', label: 'Russian', native_label: 'Русский' },
  { code: 'sm', label: 'Samoan', native_label: 'Gagana Samoa' },
  { code: 'sg', label: 'Sango', native_label: 'Sängö' },
  { code: 'sa', label: 'Sanskrit', native_label: 'संस्कृतम्' },
  { code: 'sc', label: 'Sardinian', native_label: 'Sardu' },
  { code: 'gd', label: 'Scottish Gaelic', native_label: 'Gàidhlig' },
  { code: 'sr', label: 'Serbian', native_label: 'Српски' },
  { code: 'sn', label: 'Shona', native_label: 'chiShona' },
  { code: 'sd', label: 'Sindhi', native_label: 'سنڌي', rtl: true },
  { code: 'si', label: 'Sinhala', native_label: 'සිංහල' },
  { code: 'sk', label: 'Slovak', native_label: 'Slovenčina' },
  { code: 'sl', label: 'Slovene', native_label: 'Slovenščina' },
  { code: 'so', label: 'Somali', native_label: 'Soomaali' },
  { code: 'nr', label: 'South Ndebele', native_label: 'isiNdebele' },
  { code: 'st', label: 'Southern Sotho', native_label: 'Sesotho' },
  { code: 'es', label: 'Spanish', native_label: 'Español' },
  { code: 'es-ar', label: 'Spanish (Argentina)', native_label: 'Español (Argentina)' },
  { code: 'es-cl', label: 'Spanish (Chile)', native_label: 'Español (Chile)' },
  { code: 'es-co', label: 'Spanish (Colombia)', native_label: 'Español (Colombia)' },
  { code: 'es-mx', label: 'Spanish (Mexico)', native_label: 'Español (México)' },
  { code: 'es-es', label: 'Spanish (Spain)', native_label: 'Español (España)' },
  { code: 'su', label: 'Sundanese', native_label: 'Basa Sunda' },
  { code: 'sw', label: 'Swahili', native_label: 'Kiswahili' },
  { code: 'ss', label: 'Swati', native_label: 'SiSwati' },
  { code: 'sv', label: 'Swedish', native_label: 'Svenska' },
  { code: 'tl', label: 'Tagalog', native_label: 'Tagalog' },
  { code: 'ty', label: 'Tahitian', native_label: 'Reo Tahiti' },
  { code: 'tg', label: 'Tajik', native_label: 'Тоҷикӣ' },
  { code: 'ta', label: 'Tamil', native_label: 'தமிழ்' },
  { code: 'tt', label: 'Tatar', native_label: 'Татарча' },
  { code: 'te', label: 'Telugu', native_label: 'తెలుగు' },
  { code: 'th', label: 'Thai', native_label: 'ไทย' },
  { code: 'bo', label: 'Tibetan', native_label: 'བོད་ཡིག' },
  { code: 'ti', label: 'Tigrinya', native_label: 'ትግርኛ' },
  { code: 'to', label: 'Tonga', native_label: 'Lea fakatonga' },
  { code: 'ts', label: 'Tsonga', native_label: 'Xitsonga' },
  { code: 'tn', label: 'Tswana', native_label: 'Setswana' },
  { code: 'tr', label: 'Turkish', native_label: 'Türkçe' },
  { code: 'tk', label: 'Turkmen', native_label: 'Türkmen' },
  { code: 'tw', label: 'Twi', native_label: 'Twi' },
  { code: 'ug', label: 'Uyghur', native_label: 'ئۇيغۇرچە', rtl: true },
  { code: 'uk', label: 'Ukrainian', native_label: 'Українська' },
  { code: 'ur', label: 'Urdu', native_label: 'اردو', rtl: true },
  { code: 'uz', label: 'Uzbek', native_label: 'Oʻzbekcha' },
  { code: 've', label: 'Venda', native_label: 'Tshivenḓa' },
  { code: 'vi', label: 'Vietnamese', native_label: 'Tiếng Việt' },
  { code: 'vo', label: 'Volapük', native_label: 'Volapük' },
  { code: 'wa', label: 'Walloon', native_label: 'Walon' },
  { code: 'cy', label: 'Welsh', native_label: 'Cymraeg' },
  { code: 'fy', label: 'Western Frisian', native_label: 'Frysk' },
  { code: 'wo', label: 'Wolof', native_label: 'Wollof' },
  { code: 'xh', label: 'Xhosa', native_label: 'isiXhosa' },
  { code: 'yi', label: 'Yiddish', native_label: 'ייִדיש' },
  { code: 'yo', label: 'Yoruba', native_label: 'Yorùbá' },
  { code: 'za', label: 'Zhuang', native_label: 'Saɯ cueŋƅ' },
  { code: 'zu', label: 'Zulu', native_label: 'isiZulu' },
];

// Maps and sets for faster lookups
const LOCALES_BY_CODE = new Map<string, LocaleOption>(LOCALES.map((locale) => [locale.code, locale]));
const LOCALES_CODES = new Set<string>(LOCALES.map((locale) => locale.code));

/**
 * Get locale by code
 */
export function getLocaleByCode(code: string): LocaleOption | undefined {
  return LOCALES_BY_CODE.get(code);
}

/**
 * Check if a locale code is supported
 */
export function isLocaleCodeSupported(code: string): boolean {
  return LOCALES_CODES.has(code);
}

/**
 * Strip characters that aren't valid in a region subtag and lowercase the rest.
 * Keeps only letters and digits (e.g. "BE" -> "be", "419" stays "419").
 */
export function sanitizeRegionCode(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Combine a base language code and optional region subtag into a full locale code.
 * e.g. ("nl", "be") -> "nl-be", ("nl", "") -> "nl".
 */
export function buildLocaleCode(language: string, region: string): string {
  return region ? `${language}-${region}` : language;
}

/**
 * Split a locale code into its language and region parts at the first hyphen.
 * e.g. "fr-ca" -> { language: "fr", region: "ca" }, "nl" -> { language: "nl", region: "" }.
 */
export function parseLocaleCode(code: string): { language: string; region: string } {
  const dashIndex = code.indexOf('-');
  if (dashIndex === -1) {
    return { language: code, region: '' };
  }
  return { language: code.slice(0, dashIndex), region: code.slice(dashIndex + 1) };
}

/**
 * Validate a BCP-47-style locale code: a 2-3 letter language, optionally
 * followed by hyphen-separated region/script subtags (e.g. "nl", "nl-be", "zh-hans-cn").
 */
export function isValidLocaleCode(code: string): boolean {
  return /^[a-z]{2,3}(-[a-z0-9]{2,4})*$/.test(code);
}

/**
 * Check if a locale is right-to-left
 */
export function isLocaleRtl(locale: LocaleOption): boolean {
  return locale.rtl === true;
}

/**
 * Translatable item extracted from pages
 */
export interface TranslatableItem {
  key: string; // Unique identifier for the item (same key for all locales)
  source_type: 'page' | 'folder' | 'component' | 'cms'; // Source type (page, folder, component, cms)
  source_id: string; // Source ID (e.g., page ID, folder ID, component ID, collection item ID)
  content_key: string; // Source key (e.g., 'layer:{layerId}:text', 'seo:title', 'slug')
  content_type: TranslationContentType; // Content type (text, richtext, asset, code)
  content_value: string; // Current text value (may contain inline variables)
  open_in_sheet?: boolean; // If true, editing opens in a right-side sheet panel (for block-level rich text)
  info: {
    icon: IconProps['name']; // Icon name for the item
    label: string; // Item label (e.g., "SEO Title", "Heading")
    description?: string; // Optional item description
    // Optional breadcrumb segments rendered inline (icon + label, › separated).
    // Used by component override rows: "[component] Name › [type] Variable".
    segments?: Array<{ icon: IconProps['name']; label: string }>;
  }
}

/**
 * Extract alt text from an image layer
 * @param layer - Layer with image variables
 * @returns Alt text content or null if not available
 */
export function extractImageAltText(layer: Layer): string | null {
  // Only use variables.image.alt (DynamicTextVariable)
  if (!layer.variables?.image?.alt || layer.variables.image.alt.type !== 'dynamic_text') {
    return null;
  }

  const altText = layer.variables.image.alt.data.content;

  if (!altText || !altText.trim()) {
    return null;
  }

  return altText.trim();
}

/**
 * Decide how a layer's text content should be surfaced in the localization UI.
 *
 * Classification follows the *current* content, not the source layer type:
 * - A `richText` layer whose content currently has formatting (bold, lists,
 *   headings, etc.) gets the full sheet editor.
 * - A `richText` layer whose content is currently flat plain text falls back
 *   to a simple inline input — there's nothing to format anyway.
 * - All other layers (heading, paragraph, span, etc.) are always flattened
 *   to plain text. Their on-canvas widget doesn't expose formatting
 *   controls, so offering them in translation would be misleading.
 *
 * The returned `value` always uses the canonical inline-variable string
 * format for `text` content, and the JSON-stringified Tiptap doc for
 * `richtext` content, so downstream rendering is unambiguous.
 */
function classifyTextVariableForTranslation(
  textVariable: DynamicTextVariable | DynamicRichTextVariable | undefined | null,
  isRichSource: boolean
): { contentType: 'text' | 'richtext'; value: string; openInSheet: boolean } | null {
  if (!textVariable) return null;

  if (textVariable.type === 'dynamic_text') {
    const text = textVariable.data.content;
    if (!text || typeof text !== 'string' || !text.trim()) return null;
    if (looksLikeFormattedHtml(text) || text.includes('<ycode-inline-variable>')) {
      return { contentType: 'richtext', value: text.trim(), openInSheet: isRichSource };
    }
    return { contentType: 'text', value: text.trim(), openInSheet: false };
  }

  if (textVariable.type === 'dynamic_rich_text') {
    const doc = textVariable.data.content;
    if (!doc || typeof doc !== 'object') return null;

    if (tiptapDocHasFormatting(doc) || hasVariableNode(doc)) {
      const json = JSON.stringify(doc);
      if (!hasAnyTextOrVariable(doc)) return null;
      return { contentType: 'richtext', value: json, openInSheet: isRichSource };
    }

    const canonical = tiptapDocToCanonicalString(doc).trim();
    if (!canonical) return null;
    return { contentType: 'text', value: canonical, openInSheet: false };
  }

  return null;
}

function classifyLayerTextForTranslation(
  layer: Layer
): { contentType: 'text' | 'richtext'; value: string; openInSheet: boolean } | null {
  // Only true rich-text layers (block-level editor with paragraphs/headings/
  // lists) open in the doc-style sheet. Simple text/heading layers flatten
  // multi-paragraph content to line breaks on canvas, so the translation
  // editor should stay inline and compact to match.
  return classifyTextVariableForTranslation(layer.variables?.text as any, isRichTextLayer(layer));
}

/**
 * Extract translatable media items (image src/alt, video src/poster, audio src)
 * from a single layer. Shared by both the recursive and shallow extractors.
 */
function extractMediaTranslatableItems(
  layer: Layer,
  sourceType: 'page' | 'component',
  sourceId: string,
  items: TranslatableItem[]
): void {
  const layerName = getLayerName(layer);

  if (layer.name === 'image' && layer.variables?.image) {
    const imageSrc = layer.variables.image.src;
    if (imageSrc && imageSrc.type === 'asset' && imageSrc.data?.asset_id) {
      items.push({
        key: `${sourceType}:${sourceId}:layer:${layer.id}:image_src`,
        source_type: sourceType,
        source_id: sourceId,
        content_key: `layer:${layer.id}:image_src`,
        content_type: 'asset_id',
        content_value: imageSrc.data.asset_id,
        info: { icon: 'image', label: `${layerName} (source)` },
      });
    }

    const imageAlt = extractImageAltText(layer);
    if (imageAlt) {
      items.push({
        key: `${sourceType}:${sourceId}:layer:${layer.id}:image_alt`,
        source_type: sourceType,
        source_id: sourceId,
        content_key: `layer:${layer.id}:image_alt`,
        content_type: 'text',
        content_value: imageAlt,
        info: { icon: 'image', label: `${layerName} (alt text)` },
      });
    }
  }

  if (layer.name === 'video' && layer.variables?.video) {
    const videoSrc = layer.variables.video.src;
    if (videoSrc && videoSrc.type === 'asset' && videoSrc.data?.asset_id) {
      items.push({
        key: `${sourceType}:${sourceId}:layer:${layer.id}:video_src`,
        source_type: sourceType,
        source_id: sourceId,
        content_key: `layer:${layer.id}:video_src`,
        content_type: 'asset_id',
        content_value: videoSrc.data.asset_id,
        info: { icon: 'video', label: `${layerName} (source)` },
      });
    }

    const videoPoster = layer.variables.video.poster;
    if (videoPoster && videoPoster.type === 'asset' && videoPoster.data?.asset_id) {
      items.push({
        key: `${sourceType}:${sourceId}:layer:${layer.id}:video_poster`,
        source_type: sourceType,
        source_id: sourceId,
        content_key: `layer:${layer.id}:video_poster`,
        content_type: 'asset_id',
        content_value: videoPoster.data.asset_id,
        info: { icon: 'image', label: `${layerName} (poster)` },
      });
    }
  }

  if (layer.name === 'audio' && layer.variables?.audio?.src) {
    const audioSrc = layer.variables.audio.src;
    if (audioSrc.type === 'asset' && audioSrc.data?.asset_id) {
      items.push({
        key: `${sourceType}:${sourceId}:layer:${layer.id}:audio_src`,
        source_type: sourceType,
        source_id: sourceId,
        content_key: `layer:${layer.id}:audio_src`,
        content_type: 'asset_id',
        content_value: audioSrc.data.asset_id,
        info: { icon: 'audio', label: `${layerName} (source)` },
      });
    }
  }
}

/**
 * Extract translatable items from a component instance's `componentOverrides`.
 *
 * Per-instance overrides are page-scoped: each instance can be translated
 * independently. Keys mirror what `translateComponentOverrides` consumes at
 * render time:
 *   - `layer:<instanceId>:override:text:<varId>`
 *   - `layer:<instanceId>:override:rich_text:<varId>`
 *   - `layer:<instanceId>:override:image_src:<varId>`
 *   - `layer:<instanceId>:override:image_alt:<varId>`
 */
function extractComponentOverrideTranslatableItems(
  layer: Layer,
  pageId: string,
  componentsById: Map<string, Component> | undefined,
  items: TranslatableItem[]
): void {
  const overrides = layer.componentOverrides;
  if (!overrides || !layer.componentId) return;

  const component = componentsById?.get(layer.componentId);
  const componentName = component?.name || getLayerName(layer);
  const getVar = (varId: string): ComponentVariable | undefined =>
    component?.variables?.find(v => v.id === varId);

  // Build the item `info`: a flattened label (for search) plus inline
  // breadcrumb segments "[component] Name › [type] Variable".
  const buildInfo = (
    variableLabel: string,
    typeIcon: IconProps['name']
  ): TranslatableItem['info'] => ({
    icon: 'component',
    label: `${componentName} › ${variableLabel}`,
    segments: [
      { icon: 'component', label: componentName },
      { icon: typeIcon, label: variableLabel },
    ],
  });

  // Text and rich-text overrides
  for (const category of ['text', 'rich_text'] as const) {
    const catOverrides = overrides[category];
    if (!catOverrides) continue;

    for (const [varId, value] of Object.entries(catOverrides)) {
      const classification = classifyTextVariableForTranslation(
        value as DynamicTextVariable | DynamicRichTextVariable,
        category === 'rich_text'
      );
      if (!classification) continue;

      const variableName = getVar(varId)?.name || getLayerName(layer);
      items.push({
        key: `page:${pageId}:layer:${layer.id}:override:${category}:${varId}`,
        source_type: 'page',
        source_id: pageId,
        content_key: `layer:${layer.id}:override:${category}:${varId}`,
        content_type: classification.contentType,
        content_value: classification.value,
        open_in_sheet: classification.openInSheet,
        info: buildInfo(variableName, classification.contentType === 'richtext' ? 'type' : 'text'),
      });
    }
  }

  // Image overrides (source asset + alt text)
  const imageOverrides = overrides.image;
  if (imageOverrides) {
    for (const [varId, value] of Object.entries(imageOverrides)) {
      const imageValue = value as any;
      const variableName = getVar(varId)?.name || getLayerName(layer);

      const src = imageValue?.src;
      if (src && src.type === 'asset' && src.data?.asset_id) {
        items.push({
          key: `page:${pageId}:layer:${layer.id}:override:image_src:${varId}`,
          source_type: 'page',
          source_id: pageId,
          content_key: `layer:${layer.id}:override:image_src:${varId}`,
          content_type: 'asset_id',
          content_value: src.data.asset_id,
          info: buildInfo(`${variableName} (source)`, 'image'),
        });
      }

      const alt = imageValue?.alt;
      if (alt && alt.type === 'dynamic_text' && typeof alt.data?.content === 'string' && alt.data.content.trim()) {
        items.push({
          key: `page:${pageId}:layer:${layer.id}:override:image_alt:${varId}`,
          source_type: 'page',
          source_id: pageId,
          content_key: `layer:${layer.id}:override:image_alt:${varId}`,
          content_type: 'text',
          content_value: alt.data.content.trim(),
          info: buildInfo(`${variableName} (alt text)`, 'text'),
        });
      }
    }
  }
}

/**
 * Recursively extract all translatable text items from layers.
 * When `componentsById` is provided (page context only), per-instance
 * component overrides are surfaced as page-scoped translatable items.
 */
function extractLayerTranslatableItems(
  layers: Layer[],
  sourceType: 'page' | 'component',
  sourceId: string,
  items: TranslatableItem[],
  componentsById?: Map<string, Component>
): void {
  for (const layer of layers) {
    // The locale-selector label renders the active locale name dynamically and
    // doesn't need translating. Skip the whole subtree by its parent (`name`)
    // as well as the inner label layer (`key`) — older content may be missing
    // the `localeSelectorLabel` key.
    if (layer.name === 'localeSelector' || layer.key === 'localeSelectorLabel') continue;

    const classification = classifyLayerTextForTranslation(layer);

    if (classification) {
      items.push({
        key: `${sourceType}:${sourceId}:layer:${layer.id}:text`,
        source_type: sourceType,
        source_id: sourceId,
        content_key: `layer:${layer.id}:text`,
        content_type: classification.contentType,
        content_value: classification.value,
        open_in_sheet: classification.openInSheet,
        info: {
          icon: getLayerIcon(layer),
          label: getLayerName(layer),
        },
      });
    }

    extractMediaTranslatableItems(layer, sourceType, sourceId, items);

    // Component instance overrides are page-scoped and translated per instance.
    if (sourceType === 'page' && layer.componentId && layer.componentOverrides) {
      extractComponentOverrideTranslatableItems(layer, sourceId, componentsById, items);
    }

    if (layer.children && Array.isArray(layer.children) && layer.children.length > 0) {
      extractLayerTranslatableItems(layer.children, sourceType, sourceId, items, componentsById);
    }
  }
}

/**
 * Extract SEO translatable items from page settings
 */
function classifySeoValue(value: string): { contentType: 'text' | 'richtext'; openInSheet: boolean } {
  if (looksLikeFormattedHtml(value) || value.includes('<ycode-inline-variable>')) {
    return { contentType: 'richtext', openInSheet: true };
  }
  return { contentType: 'text', openInSheet: false };
}

function extractSeoItems(
  pageId: string,
  seo: { title?: string; description?: string; image?: StringAssetId | FieldVariable | null } | undefined,
  items: TranslatableItem[]
): void {
  if (!seo) return;

  if (seo.title && typeof seo.title === 'string' && seo.title.trim()) {
    const classification = classifySeoValue(seo.title);
    items.push({
      key: `page:${pageId}:seo:title`,
      source_type: 'page',
      source_id: pageId,
      content_key: 'seo:title',
      content_type: classification.contentType,
      content_value: seo.title.trim(),
      open_in_sheet: classification.openInSheet,
      info: {
        icon: 'search',
        label: 'SEO Title',
      },
    });
  }

  if (seo.description && typeof seo.description === 'string' && seo.description.trim()) {
    const classification = classifySeoValue(seo.description);
    items.push({
      key: `page:${pageId}:seo:description`,
      source_type: 'page',
      source_id: pageId,
      content_key: 'seo:description',
      content_type: classification.contentType,
      content_value: seo.description.trim(),
      open_in_sheet: classification.openInSheet,
      info: {
        icon: 'search',
        label: 'SEO Description',
      },
    });
  }

  // Only a fixed asset (not a CMS field variable) is translatable per locale.
  if (typeof seo.image === 'string' && seo.image.trim()) {
    items.push({
      key: `page:${pageId}:seo:image`,
      source_type: 'page',
      source_id: pageId,
      content_key: 'seo:image',
      content_type: 'asset_id',
      content_value: seo.image,
      info: {
        icon: 'image',
        label: 'Social preview',
      },
    });
  }
}

/**
 * Extract translatable custom code items from page settings.
 * Lets multilingual sites emit locale-specific JSON-LD, meta tags or scripts.
 */
function extractCustomCodeItems(
  pageId: string,
  customCode: { head?: string; body?: string } | undefined,
  items: TranslatableItem[]
): void {
  if (!customCode) return;

  const slots = [
    { key: 'head', value: customCode.head, label: 'Header code' },
    { key: 'body', value: customCode.body, label: 'Body code' },
  ] as const;

  for (const slot of slots) {
    if (!slot.value || typeof slot.value !== 'string' || !slot.value.trim()) continue;

    items.push({
      key: `page:${pageId}:custom_code:${slot.key}`,
      source_type: 'page',
      source_id: pageId,
      content_key: `custom_code:${slot.key}`,
      content_type: 'code',
      content_value: slot.value.trim(),
      info: {
        icon: 'code',
        label: slot.label,
      },
    });
  }
}

/**
 * Extract all translatable items from a page (slug, SEO, custom code, and layers)
 * Ordered: slug first, then SEO settings, then custom code, then layer texts
 * Note: Dynamic page slugs and index pages (homepage / folder index) are
 * excluded — their slug doesn't contribute to the URL.
 */
export function extractPageTranslatableItems(
  page: Page,
  layers: Layer[],
  locale?: Locale,
  components?: Component[]
): TranslatableItem[] {
  const items: TranslatableItem[] = [];

  // 1. Extract slug (first) - exclude dynamic, index, and error pages
  if (!page.is_dynamic && !page.is_index && !page.error_page && page.slug && page.slug.trim()) {
    const localeName = locale?.label || 'localized';
    items.push({
      key: `page:${page.id}:slug`,
      source_type: 'page',
      source_id: page.id,
      content_key: 'slug',
      content_type: 'text',
      content_value: page.slug.trim(),
      info: {
        icon: 'link',
        label: 'Page slug',
        description: `Affects the ${localeName} URL generated for this page`,
      },
    });
  }

  // 2. Extract SEO items (second)
  extractSeoItems(page.id, page.settings?.seo, items);

  // 3. Extract custom code items (third)
  extractCustomCodeItems(page.id, page.settings?.custom_code, items);

  // 4. Extract layer texts (fourth), including per-instance component overrides
  if (layers && Array.isArray(layers) && layers.length > 0) {
    const componentsById = components
      ? new Map(components.map(c => [c.id, c]))
      : undefined;
    extractLayerTranslatableItems(layers, 'page', page.id, items, componentsById);
  }

  return items;
}

/**
 * Extract all translatable items from a folder (slug only)
 */
export function extractFolderTranslatableItems(
  folder: { id: string; slug: string; name: string },
  locale?: Locale
): TranslatableItem[] {
  const items: TranslatableItem[] = [];

  // Extract folder slug
  if (folder.slug && folder.slug.trim()) {
    const localeName = locale?.label || 'localized';
    items.push({
      key: `folder:${folder.id}:slug`,
      source_type: 'folder',
      source_id: folder.id,
      content_key: 'slug',
      content_type: 'text',
      content_value: folder.slug.trim(),
      info: {
        icon: 'folder',
        label: 'Folder slug',
        description: `Affects the ${localeName} URLs of all pages and folders inside this folder`,
      },
    });
  }

  return items;
}

/**
 * Extract all translatable items from a component (layer texts only)
 */
export function extractComponentTranslatableItems(
  component: { id: string; name: string },
  layers: Layer[]
): TranslatableItem[] {
  const items: TranslatableItem[] = [];

  // Extract layer texts only (components don't have slug or SEO)
  if (layers && Array.isArray(layers) && layers.length > 0) {
    extractLayerTranslatableItems(layers, 'component', component.id, items);
  }

  return items;
}

/**
 * Extract all translatable items from a CMS collection item
 * Only extracts text and rich_text field values
 */
export function extractCmsTranslatableItems(
  collectionItem: { id: string; collection_id: string; values: Record<string, string> },
  fields: Array<{ id: string; name: string; type: string; key: string | null }>,
  locale?: Locale
): TranslatableItem[] {
  const items: TranslatableItem[] = [];

  // Extract translatable field values (text and rich_text only)
  for (const field of fields) {
    // Only translate text and rich_text fields
    if (field.type !== 'text' && field.type !== 'rich_text') {
      continue;
    }

    const fieldValue = collectionItem.values[field.id];

    // Skip empty values — rich_text values may be parsed Tiptap objects
    if (!fieldValue) {
      continue;
    }

    let contentValue: string;
    if (typeof fieldValue === 'object') {
      contentValue = JSON.stringify(fieldValue);
    } else {
      contentValue = String(fieldValue).trim();
      if (!contentValue) continue;
    }

    const isSlugField = field.key === 'slug';
    const localeName = locale?.label || 'localized';

    // Build content_key: field:key:{key} or field:id:{id} when key is null
    const contentKey = field.key
      ? `field:key:${field.key}`
      : `field:id:${field.id}`;

    const isRichText = field.type === 'rich_text';
    items.push({
      key: `cms:${collectionItem.id}:${contentKey}`,
      source_type: 'cms',
      source_id: collectionItem.id,
      content_key: contentKey,
      content_type: isRichText ? 'richtext' : 'text',
      content_value: contentValue,
      open_in_sheet: isRichText,
      info: {
        icon: isRichText ? 'type' : 'text',
        label: field.name,
        description: isSlugField ? `Affects ${localeName} URLs generated by dynamic pages using this CMS item` : undefined,
      },
    });
  }

  // Order: slug first, then other fields
  return items.sort((a, b) => {
    const aIsSlug = a.content_key === 'field:key:slug';
    const bIsSlug = b.content_key === 'field:key:slug';
    if (aIsSlug && !bIsSlug) return -1;
    if (!aIsSlug && bIsSlug) return 1;
    return 0;
  });
}

/**
 * Generate a translatable key from a Translation
 * Format: source_type:source_id:content_key
 * @param translation - Translation object or object with source_type, source_id, and content_key
 * @returns Translatable key string
 */
// `getTranslatableKey` and the runtime translation helpers were moved to
// `lib/locale-runtime.ts` (template-free) so leaf modules like
// `lib/page-utils.ts` and the public renderer can import them without
// transitively pulling in the builder-only extractors and the template tree.

/**
 * Extract all layer content as a key-value map
 * Returns map of content keys to their values
 * Format: { "layer:{id}:text": "content", "layer:{id}:alt": "alt text" }
 * Uses extractLayerTranslatableItems internally for consistency
 */
export function extractLayerContentMap(
  layers: Layer[],
  sourceType: 'page' | 'component' = 'page',
  sourceId: string = 'temp'
): Record<string, string> {
  const items: TranslatableItem[] = [];

  // Use existing extractLayerTranslatableItems for consistency
  extractLayerTranslatableItems(layers, sourceType, sourceId, items);

  // Convert items to content map (content_key -> content_value)
  const contentMap: Record<string, string> = {};
  for (const item of items) {
    contentMap[item.content_key] = item.content_value;
  }

  return contentMap;
}

// `getTranslatedAssetId` / `getTranslatedText` moved to `lib/locale-runtime.ts`
// (see note above).

/**
 * Inject translated text and assets into layers recursively.
 * Replaces layer text content and asset sources with translations when available.
 * Handles both page-level and component-level translations via _masterComponentId.
 *
 * Shared between the server-side page fetcher (preview / published) and the
 * builder canvas so both paths produce identical output.
 *
 * @param defaultMasterComponentId - When provided, any layer that doesn't carry
 *   `_masterComponentId` is treated as belonging to this component. Used by the
 *   builder canvas while editing a component definition (where the rendered
 *   layers are the component's raw layers, not a resolved instance), so
 *   translations stored under `component:{componentId}:...` apply.
 */
export function injectTranslatedText(
  layers: Layer[],
  pageId: string,
  translations: Record<string, Translation>,
  options?: { includeIncomplete?: boolean; defaultMasterComponentId?: string }
): Layer[] {
  const valueOptions = options?.includeIncomplete ? { includeIncomplete: true } : undefined;
  return layers.map(layer => {
    const updates: Partial<Layer> = {};
    const variableUpdates: Partial<Layer['variables']> = {};

    // Use original layer ID for translation lookups — after resolveComponents,
    // child layer IDs are transformed to instance-specific IDs (e.g., "instanceId-childId")
    // but translations are stored with the original component layer IDs.
    const translationLayerId = (layer as any)._originalLayerId || layer.id;
    const masterComponentId =
      ((layer as any)._masterComponentId as string | undefined) ?? options?.defaultMasterComponentId;

    // 1. Inject text translation
    const textTranslationKey = buildLayerTranslationKey(pageId, `layer:${translationLayerId}:text`, masterComponentId);
    const textTranslation = getTranslationByKey(translations, textTranslationKey);

    const textValue = getTranslationValue(textTranslation, valueOptions);
    // A layer-level text translation whose value is a rich-text doc still
    // containing an unresolved `dynamicVariable` node is a binding artefact
    // (the translation UI re-captured the field binding, not real translated
    // text). Injecting it raw overwrites the already collection-resolved text
    // with an unresolvable node, rendering empty. The actual localization for
    // such bindings comes from the CMS field translation applied during
    // collection resolution, so skip the layer translation in this case.
    const textReintroducesDynamicVariable = richTextHasDynamicVariable(textValue);
    // Only inject when the layer actually has a text variable to translate.
    // Stale/orphan translation rows (e.g. legacy migration artefacts that
    // point at an ancestor div/section without `variables.text`) would
    // otherwise materialise text content on layers that should have none,
    // breaking layout with random strings.
    // Skip the plain component-scope layer translation when this layer's text
    // was set by an instance override — the override value has already been
    // translated at page scope via `translateComponentOverrides`, and
    // re-translating here would clobber it with the component default.
    //
    // Layers with an active component-variable binding (`variables.text.id`)
    // are handled by the dedicated branch below, which preserves the binding
    // id while injecting the translated content (replacing the whole variable
    // would strip the id and break the binding lookup chain).
    const hasComponentVariableBinding = !!(layer.variables?.text as any)?.id;
    if (
      textValue
      && !textReintroducesDynamicVariable
      && layer.variables?.text
      && !(layer as any)._textFromOverride
      && !hasComponentVariableBinding
    ) {
      // Choose the injected variable type based on the translation's stored
      // content_type, not the source layer's. A `dynamic_text` source can have
      // a `richtext` translation (e.g. translator added a line break, or legacy
      // migration upgraded a translation containing `<br>`) — stuffing the raw
      // Tiptap JSON into a `dynamic_text` variable would render as literal JSON.
      // The renderer handles `dynamic_rich_text` on simple text/heading layers
      // by flattening paragraphs into the layer's single tag.
      // Drive the injected variable type off the actual value shape, not the
      // stored `content_type` — legacy/mismatched rows can disagree (a `text`
      // row holding a Tiptap JSON doc, or a `richtext` row holding plain text).
      // This keeps generated pages correct regardless of the stored type.
      if (looksLikeTiptapJson(textValue)) {
        // Serialized Tiptap doc → rich content. The renderer flattens it for
        // simple text/heading layers, so this is safe even when the source is
        // a `dynamic_text` layer. Avoids rendering raw JSON as visible text.
        (variableUpdates as any).text = createDynamicRichTextVariable(textValue);
      } else if (layer.variables?.text?.type === 'dynamic_rich_text') {
        // Plain-text value for a rich-text source: convert without JSON.parse.
        (variableUpdates as any).text = createDynamicRichTextVariableFromPlainText(textValue);
      } else {
        // Plain-text value for a simple text source.
        (variableUpdates as any).text = createDynamicTextVariable(textValue);
      }
    } else if (
      textValue
      && !textReintroducesDynamicVariable
      && hasComponentVariableBinding
      && !(layer as any)._textFromOverride
    ) {
      // Layer text is bound to a component variable (`variables.text.id`).
      // Inject the translated content while preserving the binding `id` so the
      // editor still sees the variable link and the renderer can use the
      // localized value. Replacing the whole variable (as above) would strip
      // the `id` and break the binding lookup chain.
      const existingText = layer.variables!.text as any;
      if (existingText.type === 'dynamic_rich_text') {
        const translated = looksLikeTiptapJson(textValue)
          ? createDynamicRichTextVariable(textValue)
          : createDynamicRichTextVariableFromPlainText(textValue);
        (variableUpdates as any).text = { ...translated, id: existingText.id };
      } else {
        (variableUpdates as any).text = {
          ...existingText,
          data: { ...existingText.data, content: textValue },
        };
      }
      // Flag so the renderer prefers this injected (translated) content over the
      // bound component variable's default when localizing on canvas. Without
      // this, the binding-resolution branch would render the untranslated
      // default value instead.
      (updates as any)._textTranslated = true;
    }

    // 2. Inject asset translations for media layers
    if (layer.name === 'image' && !(layer as any)._imageFromOverride) {
      const imageSrcKey = buildLayerTranslationKey(pageId, `layer:${translationLayerId}:image_src`, masterComponentId);
      const imageSrcTranslation = getTranslationByKey(translations, imageSrcKey);
      const imageAltKey = buildLayerTranslationKey(pageId, `layer:${translationLayerId}:image_alt`, masterComponentId);
      const imageAltTranslation = getTranslationByKey(translations, imageAltKey);

      if (imageSrcTranslation || imageAltTranslation) {
        const imageUpdates: any = { ...(layer.variables?.image as any) };

        if (imageSrcTranslation && imageSrcTranslation.content_value) {
          imageUpdates.src = createAssetVariable(imageSrcTranslation.content_value);
        }

        const imageAltValue = getTranslationValue(imageAltTranslation, valueOptions);
        if (imageAltValue) {
          imageUpdates.alt = createDynamicTextVariable(imageAltValue);
        } else {
          // Preserve original alt if no translation
          imageUpdates.alt = layer.variables?.image?.alt || createDynamicTextVariable('');
        }

        (variableUpdates as any).image = imageUpdates;
      }
    }

    if (layer.name === 'video') {
      const videoSrcKey = buildLayerTranslationKey(pageId, `layer:${translationLayerId}:video_src`, masterComponentId);
      const videoSrcTranslation = getTranslationByKey(translations, videoSrcKey);
      const videoPosterKey = buildLayerTranslationKey(pageId, `layer:${translationLayerId}:video_poster`, masterComponentId);
      const videoPosterTranslation = getTranslationByKey(translations, videoPosterKey);

      if (videoSrcTranslation || videoPosterTranslation) {
        const videoUpdates: any = { ...(layer.variables?.video as any) };

        if (videoSrcTranslation && videoSrcTranslation.content_value) {
          videoUpdates.src = createAssetVariable(videoSrcTranslation.content_value);
        }

        if (videoPosterTranslation && videoPosterTranslation.content_value) {
          videoUpdates.poster = createAssetVariable(videoPosterTranslation.content_value);
        }

        (variableUpdates as any).video = videoUpdates;
      }
    }

    if (layer.name === 'audio') {
      const audioSrcKey = buildLayerTranslationKey(pageId, `layer:${translationLayerId}:audio_src`, masterComponentId);
      const audioSrcTranslation = getTranslationByKey(translations, audioSrcKey);

      if (audioSrcTranslation && audioSrcTranslation.content_value) {
        (variableUpdates as any).audio = {
          src: createAssetVariable(audioSrcTranslation.content_value),
        };
      }
    }

    if (Object.keys(variableUpdates).length > 0) {
      updates.variables = {
        ...layer.variables,
        ...variableUpdates,
      } as Layer['variables'];
    }

    if (layer.children && layer.children.length > 0) {
      updates.children = injectTranslatedText(layer.children, pageId, translations, options);
    }

    return {
      ...layer,
      ...updates,
    };
  });
}

/**
 * Pre-resolution pass: translate text/richtext/image values stored in a
 * page-instance layer's `componentOverrides` using page-scope override
 * translations. Must run BEFORE `resolveComponents` so translated overrides
 * propagate through `applyComponentOverrides` normally.
 *
 * Keys (page-scope):
 *   - `layer:<instanceLayerId>:override:text:<varId>`       (string)
 *   - `layer:<instanceLayerId>:override:rich_text:<varId>`  (Tiptap JSON string)
 *   - `layer:<instanceLayerId>:override:image_src:<varId>`  (asset_id)
 *   - `layer:<instanceLayerId>:override:image_alt:<varId>`  (string)
 *
 * Each component instance has its own translations, so different uses of the
 * same component can be translated independently — restoring per-instance
 * translation behaviour from the legacy editor.
 */
export function translateComponentOverrides(
  layers: Layer[],
  pageId: string,
  translations: Record<string, Translation> | null | undefined,
  options?: { includeIncomplete?: boolean }
): Layer[] {
  if (!translations || !layers || layers.length === 0) return layers;
  const valueOptions = options?.includeIncomplete ? { includeIncomplete: true } : undefined;

  const lookup = (key: string): string | undefined =>
    getTranslationValue(translations[`page:${pageId}:${key}`], valueOptions);

  const walk = (list: Layer[]): Layer[] =>
    list.map(layer => {
      const overrides = layer.componentOverrides;
      const nextChildren = layer.children?.length ? walk(layer.children) : layer.children;
      if (!overrides) {
        return nextChildren === layer.children ? layer : { ...layer, children: nextChildren };
      }

      let mutated = false;
      const nextOverrides: Layer['componentOverrides'] = { ...overrides };

      for (const category of ['text', 'rich_text'] as const) {
        const catOverrides = overrides[category];
        if (!catOverrides) continue;
        let categoryMutated = false;
        const next: Record<string, any> = {};
        for (const [varId, value] of Object.entries(catOverrides)) {
          const v = lookup(`layer:${layer.id}:override:${category}:${varId}`);
          const val = value as any;
          if (v !== undefined && val && typeof val === 'object' && 'data' in val) {
            // The stored override value's own type dictates the content shape,
            // NOT the override category: text overrides are persisted as
            // `dynamic_rich_text` (a Tiptap doc) even for plain `text`
            // variables. Writing a bare string into a `dynamic_rich_text`
            // value would render as empty, so convert plain translations into
            // a Tiptap doc and parse serialized docs.
            const content = val.type === 'dynamic_rich_text'
              ? (looksLikeTiptapJson(v) ? safeParseJson(v) : stringToTiptapContent(v))
              : v;
            next[varId] = { ...val, data: { ...val.data, content } };
            categoryMutated = true;
          } else {
            next[varId] = value;
          }
        }
        if (categoryMutated) {
          nextOverrides[category] = next as any;
          mutated = true;
        }
      }

      const imageOverrides = overrides.image;
      if (imageOverrides) {
        let imageMutated = false;
        const nextImage: Record<string, any> = {};
        for (const [varId, value] of Object.entries(imageOverrides)) {
          const srcAssetId = lookup(`layer:${layer.id}:override:image_src:${varId}`);
          const altText = lookup(`layer:${layer.id}:override:image_alt:${varId}`);
          if ((srcAssetId === undefined && altText === undefined) || !value || typeof value !== 'object') {
            nextImage[varId] = value;
            continue;
          }
          const src = (value as any).src;
          nextImage[varId] = {
            ...(value as any),
            ...(srcAssetId !== undefined && src
              ? { src: { ...src, data: { ...(src.data || {}), asset_id: srcAssetId } } }
              : {}),
            ...(altText !== undefined
              ? { alt: { type: 'dynamic_text', data: { content: altText } } }
              : {}),
          };
          imageMutated = true;
        }
        if (imageMutated) {
          nextOverrides.image = nextImage as any;
          mutated = true;
        }
      }

      if (!mutated && nextChildren === layer.children) return layer;
      return {
        ...layer,
        ...(mutated ? { componentOverrides: nextOverrides } : {}),
        ...(nextChildren !== layer.children ? { children: nextChildren } : {}),
      };
    });

  return walk(layers);
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Whether a translation value string looks like a serialized Tiptap document
 * (rich text). Used to decide between JSON-parsing and treating the value as
 * plain text, guarding against content_type / value-shape mismatches.
 */
export function looksLikeTiptapJson(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return !!parsed && typeof parsed === 'object';
  } catch {
    return false;
  }
}

/**
 * Whether a serialized rich-text value still contains an unresolved
 * `dynamicVariable` node (a field/collection binding). Such values must not be
 * injected as layer text — the binding renders empty outside the collection
 * resolution pipeline.
 */
export function richTextHasDynamicVariable(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.includes('"dynamicVariable"');
}

/**
 * Apply CMS translations to a collection item's values map (field_id -> value).
 * Returns a new map with translated values where available; rich-text strings are
 * cast back into Tiptap document objects via castValue so they match the shape
 * downstream renderers expect.
 */
export function applyCmsTranslations(
  itemId: string,
  itemValues: Record<string, any>,
  collectionFields: CollectionField[],
  translations?: Record<string, Translation> | null,
  options?: { includeIncomplete?: boolean }
): Record<string, any> {
  if (!translations || Object.keys(translations).length === 0) {
    return itemValues;
  }

  const valueOptions = options?.includeIncomplete ? { includeIncomplete: true } : undefined;
  const translatedValues: Record<string, any> = { ...itemValues };

  const fieldIdToKey = new Map<string, string | null>();
  const fieldIdToType = new Map<string, string>();
  for (const field of collectionFields) {
    fieldIdToKey.set(field.id, field.key);
    fieldIdToType.set(field.id, field.type);
  }

  for (const fieldId of Object.keys(itemValues)) {
    const fieldKey = fieldIdToKey.get(fieldId);

    const contentKey = fieldKey ? `field:key:${fieldKey}` : `field:id:${fieldId}`;
    const translationKey = `cms:${itemId}:${contentKey}`;
    const translation = translations[translationKey];

    const translatedValue = getTranslationValue(translation, valueOptions);
    if (translatedValue) {
      const fieldType = fieldIdToType.get(fieldId);
      translatedValues[fieldId] = fieldType
        ? castValue(translatedValue, fieldType as any)
        : translatedValue;
    }
  }

  return translatedValues;
}

/**
 * Extract the translatable items for a single layer (without recursing into children).
 * Used by the right sidebar to build the per-layer translation editor.
 */
export function extractLayerTranslatableItemsShallow(
  layer: Layer,
  sourceType: 'page' | 'component',
  sourceId: string
): TranslatableItem[] {
  const items: TranslatableItem[] = [];

  if (layer.name === 'localeSelector' || layer.key === 'localeSelectorLabel') return items;

  const classification = classifyLayerTextForTranslation(layer);
  if (classification) {
    items.push({
      key: `${sourceType}:${sourceId}:layer:${layer.id}:text`,
      source_type: sourceType,
      source_id: sourceId,
      content_key: `layer:${layer.id}:text`,
      content_type: classification.contentType,
      content_value: classification.value,
      open_in_sheet: classification.openInSheet,
      info: {
        icon: getLayerIcon(layer),
        label: getLayerName(layer),
      },
    });
  }

  extractMediaTranslatableItems(layer, sourceType, sourceId, items);

  return items;
}

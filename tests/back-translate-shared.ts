import type { Catalogue } from '../src/lib/i18n/en';
import { id } from '../src/lib/i18n/id';
import { th } from '../src/lib/i18n/th';
import { vi } from '../src/lib/i18n/vi';
import { zh } from '../src/lib/i18n/zh';
import { type Locale } from '../src/lib/i18n';

/** The raw catalogues, one per translated locale; the compiler keeps it whole. */
export const CATALOGUES = { id, zh, vi, th } satisfies Record<
  Exclude<Locale, 'en'>,
  Catalogue
>;

export const TRANSLATED = Object.keys(CATALOGUES) as Array<
  keyof typeof CATALOGUES
>;

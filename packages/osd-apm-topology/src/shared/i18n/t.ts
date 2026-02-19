/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */


/* eslint-disable camelcase */
import { DEFAULT_LOCALE, Locale, locale } from './locale';
import de from './lang/de.json';
import en from './lang/en.json';
import es from './lang/es.json';
import fr from './lang/fr.json';
import id from './lang/id.json';
import it from './lang/it.json';
import ja from './lang/ja.json';
import ko from './lang/ko.json';
import tr from './lang/tr_tr.json';
import pt_br from './lang/pt_br.json';
import zh_cn from './lang/zh_cn.json';
import zh_tw from './lang/zh_tw.json';

type Messages = typeof en;

/**
 * If you get error messages about this object, you might need to run the `replicate-translations` script.
 */
const localizedMessages: Record<Locale, Messages> = {
    [Locale.de]: de,
    [Locale.en]: en,
    [Locale.es]: es,
    [Locale.fr]: fr,
    [Locale.id]: id,
    [Locale.it]: it,
    [Locale.ja]: ja,
    [Locale.ko]: ko,
    [Locale.tr_tr]: tr,
    [Locale.pt_br]: pt_br,
    [Locale.zh_cn]: zh_cn,
    [Locale.zh_tw]: zh_tw,
};

// eslint-disable-next-line max-len, @typescript-eslint/no-shadow
export const getLocalizedMessages = (locale: Locale): Messages =>
    localizedMessages[locale] ?? localizedMessages[DEFAULT_LOCALE];

const replaceParameters = (value: string, parameters: Array<[string, string]>): string =>
    parameters.reduce(
        (acc: string, [parameterName, parameterValue]) =>
            acc.replace(new RegExp(`{${parameterName}}`, 'g'), parameterValue),
        value,
    );

// https://stackoverflow.com/questions/47057649/typescript-string-dot-notation-of-nested-object
type PathsToStringProps<T> = T extends string
    ? []
    : {
          [K in Extract<keyof T, string>]: [K, ...PathsToStringProps<T[K]>];
      }[Extract<keyof T, string>];
type Join<T extends string[], D extends string> = T extends []
    ? never
    : T extends [infer F]
      ? F
      : T extends [infer F, ...infer R]
        ? F extends string
            ? `${F}${D}${Join<Extract<R, string[]>, D>}`
            : never
        : string;
export type TId = Join<PathsToStringProps<Messages>, '.'>;

export const t = (
    // eslint-disable-next-line @typescript-eslint/no-shadow
    id: TId,
    parameters = {},
    selectedLocale = locale,
): string => {
    const messages = getLocalizedMessages(selectedLocale);
    const messagePath = id.split('.');
    const message = messagePath.reduce(
        (acc: any, key) => (acc && acc[key] !== undefined ? acc[key] : undefined),
        messages as Record<string, unknown>,
    ) ?? id;

    return typeof message === 'string' ? replaceParameters(message, Object.entries(parameters)) : id;
};

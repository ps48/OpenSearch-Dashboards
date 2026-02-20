/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

export const useDarkMode = (): boolean => {
  const [isDark, setIsDark] = useState(() => detectDarkMode());

  useEffect(() => {
    // Re-check on media query change (covers browser-level preference)
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setIsDark(detectDarkMode());
    mq.addEventListener('change', handler);

    // Watch for OSD runtime theme switches (class changes on <body>)
    const observer = new MutationObserver(() => setIsDark(detectDarkMode()));
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    return () => {
      mq.removeEventListener('change', handler);
      observer.disconnect();
    };
  }, []);

  return isDark;
};

function detectDarkMode(): boolean {
  // 1. Check OSD's theme tag (set at bootstrap)
  const themeTag = (window as any).__osdThemeTag__ || '';
  if (themeTag) return themeTag.endsWith('dark');

  // 2. Check body class (OSD toggles theme classes on <body>)
  if (document.body.className.includes('dark')) return true;

  // 3. Fallback: check if dark-mode stylesheets are loaded
  const sheets = Array.from(document.styleSheets);
  if (sheets.some((s) => s.href?.includes('dark'))) return true;

  // 4. Fallback: check OS preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

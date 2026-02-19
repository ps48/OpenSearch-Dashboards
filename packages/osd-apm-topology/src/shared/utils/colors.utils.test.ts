/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ColorScheme } from './colors.utils';

describe('ColorScheme', () => {
    it('should have all color properties defined', () => {
        expect(ColorScheme.containerBackgroundDefault).toBeDefined();
        expect(ColorScheme.containerBackgroundBreached).toBeDefined();
        expect(ColorScheme.textDefault).toBeDefined();
        expect(ColorScheme.textSecondary).toBeDefined();
        expect(ColorScheme.linkTextDefault).toBeDefined();
        expect(ColorScheme.linkTextHover).toBeDefined();
        expect(ColorScheme.buttonBackgroundHover).toBeDefined();
        expect(ColorScheme.statusIndicatorDefault).toBeDefined();
        expect(ColorScheme.statusIndicatorBreached).toBeDefined();
        expect(ColorScheme.ok).toBeDefined();
        expect(ColorScheme.faults).toBeDefined();
        expect(ColorScheme.errors).toBeDefined();
        expect(ColorScheme.requests).toBeDefined();
        expect(ColorScheme.iconFill).toBeDefined();
        expect(ColorScheme.spinnerStroke).toBeDefined();
    });

    it('should have correct CSS variable references', () => {
        expect(ColorScheme.containerBackgroundDefault).toBe('var(--color-container-default)');
        expect(ColorScheme.containerBackgroundBreached).toBe('var(--color-container-breach)');
        expect(ColorScheme.textDefault).toBe('var(--color-body-default)');
        expect(ColorScheme.textSecondary).toBe('var(--color-body-secondary)');
        expect(ColorScheme.linkTextDefault).toBe('var(--color-link-default)');
        expect(ColorScheme.linkTextHover).toBe('var(--color-link-hover)');
        expect(ColorScheme.buttonBackgroundHover).toBe('var(--color-button-hover)');
        expect(ColorScheme.statusIndicatorDefault).toBe('var(--color-status-default)');
        expect(ColorScheme.statusIndicatorBreached).toBe('var(--color-status-breached)');
        expect(ColorScheme.ok).toBe('var(--color-ok)');
        expect(ColorScheme.faults).toBe('var(--color-faults)');
        expect(ColorScheme.errors).toBe('var(--color-errors)');
        expect(ColorScheme.requests).toBe('var(--color-requests)');
        expect(ColorScheme.iconFill).toBe('var(--color-icon)');
        expect(ColorScheme.spinnerStroke).toBe('var(--color-spinner)');
    });
});

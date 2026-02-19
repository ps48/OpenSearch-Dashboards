/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export * from '@testing-library/react';

const mockFitView = jest.fn();
const mockUseReactFlow = jest.fn(() => ({
    fitView: mockFitView,
}));

// Export the mocks so they can be accessed in tests
export { mockFitView, mockUseReactFlow };

jest.mock('@xyflow/react', () => {
    const actual = jest.requireActual('@xyflow/react');
    return {
        ...actual,
        useReactFlow: () => mockUseReactFlow(),
    };
});

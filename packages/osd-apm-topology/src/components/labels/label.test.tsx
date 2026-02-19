/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '../../test_utils/jest_utilities';
import { Label } from './label';

describe('Label', () => {
    it('renders with text and children', () => {
        render(
            <Label text="Test Label">
                <div data-testid="test-child">Child</div>
            </Label>,
        );

        expect(screen.getByText('Test Label')).toBeInTheDocument();
        expect(screen.getByTestId('test-child')).toBeInTheDocument();
    });

    it('renders with correct styling', () => {
        render(
            <Label text="Test Label">
                <div data-testid="test-child">Child</div>
            </Label>,
        );

        const container = screen.getByText('Test Label').parentElement;
        expect(container).toHaveClass('flex items-center');

        const childContainer = screen.getByTestId('test-child').parentElement;
        expect(childContainer).toHaveClass('flex items-center');
    });
});

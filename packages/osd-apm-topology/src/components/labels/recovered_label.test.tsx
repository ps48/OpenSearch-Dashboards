/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '../../test_utils/jest_utilities';
import { RecoveredLabel } from './recovered_label';

// Mock the SliStatusIcon component
jest.mock('../sli_status_icon', () => ({
    SliStatusIcon: () => <div data-testid="mock-sli-status-icon" />,
}));

describe('RecoveredLabel', () => {
    it('renders with text and default icon', () => {
        render(<RecoveredLabel text="Recovered" />);

        expect(screen.getByText('Recovered')).toBeInTheDocument();
        expect(screen.getByTestId('mock-sli-status-icon')).toBeInTheDocument();
    });

    it('renders with custom children', () => {
        render(
            <RecoveredLabel text="Recovered">
                <div data-testid="custom-child">Custom Child</div>
            </RecoveredLabel>,
        );

        expect(screen.getByText('Recovered')).toBeInTheDocument();
        expect(screen.getByTestId('custom-child')).toBeInTheDocument();
        expect(screen.queryByTestId('mock-sli-status-icon')).not.toBeInTheDocument();
    });
});

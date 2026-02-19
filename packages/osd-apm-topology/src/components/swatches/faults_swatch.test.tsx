/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '../../test_utils/jest_utilities';
import { FaultsSwatch } from './faults_swatch';
import { COLOR_SWATCH_TEST_ID } from './color_swatch';

describe('FaultsSwatch', () => {
    it('renders with the correct color variable', () => {
        render(<FaultsSwatch />);

        const swatchElement = screen.getByTestId(COLOR_SWATCH_TEST_ID);
        expect(swatchElement).toBeInTheDocument();
        expect(swatchElement).toHaveStyle({ backgroundColor: 'var(--color-faults)' });
    });
});

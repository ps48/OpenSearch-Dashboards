/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '@testing-library/react';
import { BehaviorSubject } from 'rxjs';
import { NavLinkBadge } from './nav_link_badge';

describe('<NavLinkBadge />', () => {
  it('renders badge when value is non-zero', () => {
    const badge$ = new BehaviorSubject<number | string | undefined>(5);
    const { getByText } = render(<NavLinkBadge badge$={badge$} />);
    expect(getByText('5')).toBeTruthy();
  });

  it('does not render badge when value is undefined', () => {
    const badge$ = new BehaviorSubject<number | string | undefined>(undefined);
    const { container } = render(<NavLinkBadge badge$={badge$} />);
    expect(container.innerHTML).toBe('');
  });

  it('does not render badge when value is 0', () => {
    const badge$ = new BehaviorSubject<number | string | undefined>(0);
    const { container } = render(<NavLinkBadge badge$={badge$} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders badge with string value', () => {
    const badge$ = new BehaviorSubject<number | string | undefined>('NEW');
    const { getByText } = render(<NavLinkBadge badge$={badge$} />);
    expect(getByText('NEW')).toBeTruthy();
  });

  it('updates when observable emits new value', () => {
    const badge$ = new BehaviorSubject<number | string | undefined>(3);
    const { getByText, rerender } = render(<NavLinkBadge badge$={badge$} />);
    expect(getByText('3')).toBeTruthy();

    badge$.next(10);
    rerender(<NavLinkBadge badge$={badge$} />);
    expect(getByText('10')).toBeTruthy();
  });
});

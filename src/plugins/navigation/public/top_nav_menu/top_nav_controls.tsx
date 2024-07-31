/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * The OpenSearch Contributors require contributions made to
 * this file be licensed under the Apache-2.0 license or a
 * compatible open source license.
 *
 * Any modifications Copyright OpenSearch Contributors. See
 * GitHub history for details.
 */

/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import React, { ReactElement } from 'react';
import { EuiHeaderLinks } from '@elastic/eui';
import classNames from 'classnames';

import { MountPoint } from 'opensearch-dashboards/public';
import { MountPointPortal } from '../../../opensearch_dashboards_react/public';
import { TopNavControlItem } from './top_nav_control_item';
import { TopNavControlData } from './top_nav_control_data';

export interface HeaderControlProps {
  controls?: TopNavControlData[];
  className?: string;
  setMountPoint?: (menuMount: MountPoint | undefined) => void;
}

export function HeaderControl(props: HeaderControlProps): ReactElement | null {
  const { controls } = props;

  if (!Array.isArray(controls) || controls.length === 0) {
    return null;
  }

  function renderItems(): ReactElement[] {
    return controls!.map((menuItem: TopNavControlData, i: number) => {
      return <TopNavControlItem key={`nav-control-${i}`} {...menuItem} />;
    });
  }

  function renderMenu(className: string): ReactElement {
    return (
      <EuiHeaderLinks data-test-subj="top-controls" gutterSize="xs" className={className}>
        {renderItems()}
      </EuiHeaderLinks>
    );
  }

  function renderLayout() {
    const { setMountPoint } = props;
    const menuClassName = classNames('osdTopControls', props.className);

    return setMountPoint ? (
      <MountPointPortal setMountPoint={setMountPoint}>{renderMenu(menuClassName)}</MountPointPortal>
    ) : null;
  }

  return renderLayout();
}

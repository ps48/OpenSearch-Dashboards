/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import './index.scss';
import { ApmTopologyExamplePlugin } from './plugin';

export function plugin() {
  return new ApmTopologyExamplePlugin();
}

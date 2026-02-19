/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { CoreSetup, Plugin, AppMountParameters } from '../../../src/core/public';
import { DeveloperExamplesSetup } from '../../developer_examples/public';

export class ApmTopologyExamplePlugin implements Plugin {
  public setup(core: CoreSetup, deps: { developerExamples?: DeveloperExamplesSetup }) {
    core.application.register({
      id: 'apmTopologyExample',
      title: 'APM Topology Example',
      async mount(params: AppMountParameters) {
        const { renderApp } = await import('./app');
        return renderApp(params.element);
      },
    });

    if (deps.developerExamples) {
      deps.developerExamples.register({
        appId: 'apmTopologyExample',
        title: 'APM Topology',
        description: 'Interactive service topology visualization using @osd/apm-topology.',
      });
    }
  }

  public start() {}

  public stop() {}
}

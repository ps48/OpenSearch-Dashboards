/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { i18n } from '@osd/i18n';
import { TutorialsCategory } from '../../services/tutorials';
import {
  TutorialContext,
  TutorialSchema,
} from '../../services/tutorials/lib/tutorials_registry_types';
import { onPremInstructions } from '../instructions/filebeat_instructions';

export function nginxLogsSpecProvider(context: TutorialContext): TutorialSchema {
  const moduleName = 'nginx';
  const platforms = ['OSX', 'DEB', 'RPM', 'WINDOWS'] as const;
  return {
    id: 'nginxLogs',
    name: i18n.translate('home.tutorials.nginxLogs.nameTitle', {
      defaultMessage: 'Nginx logs',
    }),
    moduleName,
    category: TutorialsCategory.LOGGING,
    shortDescription: i18n.translate('home.tutorials.nginxLogs.shortDescription', {
      defaultMessage: 'Collect and parse access and error logs created by the Nginx HTTP server.',
    }),
    longDescription: i18n.translate('home.tutorials.nginxLogs.longDescription', {
      defaultMessage:
        'The `nginx` Filebeat module parses access and error logs created by the Nginx HTTP server. \
[Learn more]({learnMoreLink}).',
      values: {
        learnMoreLink: '{config.docs.beats.filebeat}/filebeat-module-nginx.html',
      },
    }),
    euiIconType: 'logoNginx',
    artifacts: {
      dashboards: [
        {
          id: '55a9e6e0-a29e-11e7-928f-5dbe6f6f5519-ecs',
          linkLabel: i18n.translate('home.tutorials.nginxLogs.artifacts.dashboards.linkLabel', {
            defaultMessage: 'Nginx logs dashboard',
          }),
          isOverview: true,
        },
      ],
      exportedFields: {
        documentationUrl: '{config.docs.beats.filebeat}/exported-fields-nginx.html',
      },
    },
    completionTimeMinutes: 10,
    onPrem: onPremInstructions(moduleName, platforms, context),
  };
}

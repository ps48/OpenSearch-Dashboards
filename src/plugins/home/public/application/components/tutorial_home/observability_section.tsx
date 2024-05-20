/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EuiCard,
  EuiFlexGroup,
  EuiFlexItem,
  EuiHorizontalRule,
  EuiIcon,
  EuiSpacer,
  EuiText,
} from '@elastic/eui';
import React from 'react';
import { getServices } from '../../opensearch_dashboards_services';

export const ObservabilityTutorialSection = ({ homeId }: { homeId: string }) => {
  const services = getServices();
  const childCards = () => {
    const observabilityCards = {
      Nginx: {
        title: 'Nginx Logs',
        iconType: 'logoNginx',
        description:
          'Collect, parse, and analyze Nginx access and error logs to monitor web server performance and troubleshoot issues.',
      },
      Apache: {
        title: 'Apache Logs',
        iconType: 'logoApache',
        description:
          'Ingest and analyze Apache HTTP Server access and error logs to gain insights into web traffic, performance, and potential issues.',
      },
      Prometheus: {
        title: 'Prometheus',
        iconType: 'logoPrometheus',
        description:
          'Collect and query metrics from Prometheus, a popular open-source monitoring system, to monitor and visualize system and application performance.',
      },
      Kubernetes: {
        title: 'Kubernetes',
        iconType: 'logoKubernetes',
        description:
          'Monitor and analyze Kubernetes cluster components, deployments, and workloads by collecting and visualizing logs, metrics, and events.',
      },
    };

    const securityCards = {
      HAProxy: {
        title: 'HAProxy',
        iconType: 'logoHAproxy',
      },
      Webhook: {
        title: 'Webhooks',
        iconType: 'logoWebhook',
      },
      Slack: {
        title: 'Slack',
        iconType: 'logoSlack',
      },
    };

    switch (homeId) {
      case 'observability':
        return observabilityCards;

      case 'security':
        return securityCards;

      default:
        break;
    }
  };

  const childCardNodes = Object.keys(childCards() ?? []).map(function (item, index) {
    return (
      <EuiFlexItem key={index} grow={false}>
        <EuiCard
          layout="horizontal"
          icon={<EuiIcon size="l" type={childCards()[item].iconType} />}
          title={childCards()[item].title}
          description={childCards()[item].description}
          onClick={() => (window.location.href = services.addBasePath(`#/tutorial/nginxLogs`))}
        />
      </EuiFlexItem>
    );
  });

  const redirecToTutorialsHome = (title: string) => {
    const path = services.addBasePath(`#/tutorial/home/${title}`);
    window.location.href = path;
  };

  return (
    <>
      <EuiText>
        <h4>Use cases</h4>
      </EuiText>
      <EuiHorizontalRule margin="m" />
      <EuiFlexGroup direction="row" alignItems="center">
        {childCardNodes}
      </EuiFlexGroup>
      <EuiSpacer />
      <EuiText>
        <h4>Detect</h4>
      </EuiText>
      <EuiHorizontalRule margin="m" />
      <EuiFlexGroup direction="row" alignItems="center">
        <EuiFlexItem grow={false}>
          <EuiCard
            layout="horizontal"
            icon={<EuiIcon size="l" type="createMultiMetricJob" />}
            title={'Detect Alerts'}
            description="Create and manage alerts based on custom queries for your data."
            onClick={() => {}}
            href="https://opensearch.org/docs/latest/observing-your-data/alerting/index/"
          />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiCard
            layout="horizontal"
            title={'Detect Anomalies'}
            icon={<EuiIcon size="l" type="outlierDetectionJob" />}
            description="Detect anomalies in your time-series data to identify deviations."
            onClick={() => {}}
            href="https://opensearch.org/docs/latest/observing-your-data/ad/index/"
          />
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer />
      <EuiText>
        <h4>Investigate</h4>
      </EuiText>
      <EuiHorizontalRule margin="m" />
      <EuiFlexGroup direction="row" alignItems="center">
        <EuiFlexItem grow={false}>
          <EuiCard
            layout="horizontal"
            icon={<EuiIcon size="l" type="logsApp" />}
            title={'Logs'}
            description="Collect, search, and analyze logs from various sources to gain insights into your system's operations and troubleshoot issues."
            onClick={() =>
              (window.location.href = services.addBasePath(`/app/observability-logs#/explorer`))
            }
          />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiCard
            layout="horizontal"
            icon={<EuiIcon size="l" type="packetbeatApp" />}
            title={'Traces'}
            description="Analyze and visualize distributed traces to understand the performance and behavior of your applications and services."
            onClick={() =>
              (window.location.href = services.addBasePath(`/app/observability-traces#/`))
            }
          />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiCard
            layout="horizontal"
            icon={<EuiIcon size="l" type="metricsApp" />}
            title={'Metrics'}
            description="Collect, visualize, and monitor system and application metrics to understand performance and identify potential issues."
            onClick={() =>
              (window.location.href = services.addBasePath(`/app/observability-metrics#/`))
            }
          />
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer />
    </>
  );
};

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
  EuiPage,
  EuiPageBody,
  EuiPageContent,
  EuiPageContentHeader,
  EuiPageContentHeaderSection,
  EuiPageHeader,
  EuiPageHeaderSection,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import React from 'react';
import { getServices } from '../../opensearch_dashboards_services';

interface TutorialHomeProps {
  homeId: string;
}

export const TutorialHome = ({ homeId }: TutorialHomeProps) => {
  const cards = {
    Observability: {
      title: 'Observability',
      iconType: 'lensApp',
      description:
        'Gain deep insights into your data and infrastructure with powerful monitoring and analysis',
    },
    Security: {
      title: 'Security',
      iconType: 'securityAnalyticsApp',
      description:
        'Protect your applications with robust security features, including access control, encryption, and auditing',
    },
    Search: {
      title: 'Search',
      iconType: 'search',
      description:
        'Unlock the power of your data with lightning-fast, full-text search and advanced query',
    },
    Analytics: {
      title: 'Analytics',
      iconType: 'visualizeApp',
      description:
        'Uncover insights and make data-driven decisions with powerful analytics tools and machine learning',
    },
  };

  const services = getServices();

  services.chrome.setBreadcrumbs([
    {
      text: 'Home',
      href: '#/',
    },
    {
      text: 'Tutorials',
      href: '#/tutorial/home/observability',
    },
  ]);

  const childCards = () => {
    const observabilityCards = {
      Nginx: {
        title: 'Nginx Logs',
        iconType: 'logoNginx',
      },
      Apache: {
        title: 'Apache Logs',
        iconType: 'logoApache',
      },
      Prometheus: {
        title: 'Prometheus',
        iconType: 'logoPrometheus',
      },
      Kubernetes: {
        title: 'Kubernetes',
        iconType: 'logoKubernetes',
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
          icon={<EuiIcon size="xxl" type={childCards()[item].iconType} />}
          title={childCards()[item].title}
          description=""
          onClick={() => (window.location.href = services.addBasePath(`#/tutorial/nginxLogs`))}
        />
      </EuiFlexItem>
    );
  });

  const redirecToTutorialsHome = (title: string) => {
    const path = services.addBasePath(`#/tutorial/home/${title}`);
    window.location.href = path;
  };

  const cardNodes = Object.keys(cards).map(function (item, index) {
    return (
      <EuiFlexItem key={index}>
        <EuiCard
          icon={<EuiIcon size="xxl" type={cards[item].iconType} />}
          title={cards[item].title}
          description={cards[item].description}
          selectable={{
            onClick: () => redirecToTutorialsHome(cards[item].title.toLowerCase()),
            isSelected: homeId === cards[item].title.toLowerCase(),
          }}
        />
      </EuiFlexItem>
    );
  });

  function capitalizeFirstLetter(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  return (
    <EuiPage>
      <EuiPageBody component="div">
        <EuiPageHeader>
          <EuiPageHeaderSection>
            <EuiTitle size="l">
              <h1>Getting started</h1>
            </EuiTitle>
          </EuiPageHeaderSection>
        </EuiPageHeader>
        <EuiPageContent id="customPanelArea">
          <EuiPageContentHeader>
            <EuiPageContentHeaderSection>
              <EuiTitle size="s">
                <h3>
                  Tutorials
                  {/* <span className="panel-header-count"> ({customPanels.length})</span> */}
                </h3>
              </EuiTitle>
              <EuiSpacer size="s" />
              <EuiText size="s" color="subdued">
                Explore our comprehensive collection of step-by-step tutorials, covering everything
                from basic setup to advanced features, to unlock the full potential of OpenSearch
                Dashboards for your data exploration and analysis needs.
              </EuiText>
            </EuiPageContentHeaderSection>
          </EuiPageContentHeader>
          <EuiHorizontalRule margin="m" />
          <EuiFlexGroup wrap direction="row" alignItems="stretch">
            {cardNodes}
          </EuiFlexGroup>
          <EuiSpacer size="l" />

          <EuiText>
            <h4>{capitalizeFirstLetter(homeId)} guides</h4>
          </EuiText>
          <EuiHorizontalRule margin="m" />
          <EuiFlexGroup direction="row" alignItems="center">
            {childCardNodes}
          </EuiFlexGroup>
        </EuiPageContent>
      </EuiPageBody>
    </EuiPage>
  );
};

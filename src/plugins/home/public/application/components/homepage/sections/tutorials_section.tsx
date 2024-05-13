/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { EuiCard, EuiFlexGroup, EuiFlexItem, EuiIcon } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import React from 'react';
import { Section } from '../../../../services/section_type/section_type';
import { getServices } from '../../../opensearch_dashboards_services';
import { renderFn } from './utils';

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

const render = renderFn(() => {
  const services = getServices();
  const getUrl = services.application.getUrlForApp;
  const darkMode = services.injectedMetadata.getBranding().darkMode;

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
          onClick={() => redirecToTutorialsHome(cards[item].title.toLowerCase())}
        />
      </EuiFlexItem>
    );
  });

  return (
    <EuiFlexGroup wrap direction="row" alignItems="stretch">
      {cardNodes}
    </EuiFlexGroup>
  );
});

export const TutorialsSection: Section = {
  id: 'home:Tutorials',
  title: i18n.translate('home.sections.tutorials.title', {
    defaultMessage: 'Getting started with your use case',
  }),
  // titleAppend: <UsecaseTypeSelector />,
  render,
};

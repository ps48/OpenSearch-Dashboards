/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EuiButtonIcon,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLink,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import React, { FC, useMemo, useState } from 'react';
import { RenderFn, Section as SectionType } from '../../../services/section_type/section_type';
import { LazyRender } from './lazy_render';

interface Props {
  render: RenderFn;
  title: SectionType['title'];
  titleAppend?: SectionType['titleAppend'];
  description?: SectionType['description'];
  links?: SectionType['links'];
}

export const Section: FC<Props> = ({ render, title, titleAppend, description, links }) => {
  const [isExpanded, setExpanded] = useState(true);

  const hasDescription = !!description;
  const hasLinks = Array.isArray(links) && links.length > 0;
  const hasDescriptionSection = hasDescription || hasLinks;
  const hasDescriptionSpacer = hasDescription && hasLinks;
  const hasTitleAppend = !!titleAppend;

  const toggleExpanded = () => setExpanded((expanded) => !expanded);

  const memoizedContent = useMemo(
    () => (
      <EuiFlexGroup direction="row" data-test-subj="homepageSectionContent">
        {hasDescriptionSection && (
          <EuiFlexItem grow={1}>
            <EuiText>{description}</EuiText>
            {hasDescriptionSpacer && <EuiSpacer />}
            {hasLinks &&
              links.map(({ label, url, props }, i) => (
                <EuiLink key={i} {...props} href={url}>
                  {label}
                </EuiLink>
              ))}
          </EuiFlexItem>
        )}
        <EuiFlexItem grow={3}>
          <LazyRender render={render} />
        </EuiFlexItem>
      </EuiFlexGroup>
    ),
    [description, hasDescriptionSection, hasDescriptionSpacer, hasLinks, links, render]
  );

  return (
    <EuiPanel
      hasBorder={false}
      hasShadow={false}
      color="transparent"
      data-test-subj="homepageSection"
    >
      <EuiFlexGroup direction="row" alignItems="center" gutterSize="s" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiButtonIcon
            iconType={isExpanded ? 'arrowDown' : 'arrowRight'}
            onClick={toggleExpanded}
            size="s"
            iconSize="m"
            color="text"
            aria-label={
              isExpanded
                ? i18n.translate('home.section.collapse', { defaultMessage: 'Collapse section' })
                : i18n.translate('home.section.expand', { defaultMessage: 'Expand section' })
            }
          />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiTitle size="m">
            <h2>{title}</h2>
          </EuiTitle>
        </EuiFlexItem>
        {hasTitleAppend && <EuiFlexItem grow={false}> {titleAppend} </EuiFlexItem>}
      </EuiFlexGroup>
      {isExpanded && memoizedContent}
    </EuiPanel>
  );
};

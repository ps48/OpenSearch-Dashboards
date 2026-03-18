/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  EuiButtonIcon,
  EuiFlexGroup,
  EuiFlexItem,
  EuiListGroup,
  EuiListGroupItem,
  EuiPopover,
  EuiToolTip,
} from '@elastic/eui';
import { ChromeNavLink } from '../..';
import { InternalApplicationStart } from '../../../application/types';
import { getOrderedLinksOrCategories, LinkItem, LinkItemType } from '../../utils';

export interface CollapsedNavStripProps {
  navLinks: ChromeNavLink[];
  appId?: string;
  navigateToApp: InternalApplicationStart['navigateToApp'];
}

interface TopLevelItem {
  id: string;
  title: string;
  iconType: string;
  isActive: boolean;
  href?: string;
  onClick?: (e: React.MouseEvent) => void;
  children?: Array<{
    id: string;
    title: string;
    href?: string;
    onClick?: (e: React.MouseEvent) => void;
  }>;
}

function collectTopLevelItems(
  navLinks: ChromeNavLink[],
  appId: string | undefined,
  navigateToApp: InternalApplicationStart['navigateToApp']
): TopLevelItem[] {
  const orderedItems = getOrderedLinksOrCategories(navLinks);
  const result: TopLevelItem[] = [];

  const makeOnClick = (linkId: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigateToApp(linkId);
  };

  const processLinkItem = (item: LinkItem) => {
    if (item.itemType === LinkItemType.LINK) {
      result.push({
        id: item.link.id,
        title: item.link.title,
        iconType: item.link.euiIconType || 'apps',
        isActive: item.link.id === appId,
        href: item.link.href,
        onClick: makeOnClick(item.link.id),
      });
    } else if (item.itemType === LinkItemType.PARENT_LINK && item.link) {
      const children = item.links
        ?.map((child) => {
          if (child.itemType === LinkItemType.LINK) {
            return {
              id: child.link.id,
              title: child.link.title,
              href: child.link.href,
              onClick: makeOnClick(child.link.id),
            };
          }
          return null;
        })
        .filter(Boolean) as TopLevelItem['children'];

      result.push({
        id: item.link.id,
        title: item.link.title,
        iconType: item.link.euiIconType || 'apps',
        isActive: item.link.id === appId || (children?.some((c) => c.id === appId) ?? false),
        children,
      });
    } else if (item.itemType === LinkItemType.CATEGORY) {
      const categoryIcon = item.category?.euiIconType;

      if (categoryIcon && item.category?.collapsible) {
        // Render category as a single icon with popover for children
        const children = item.links
          ?.map((child) => {
            if (child.itemType === LinkItemType.LINK) {
              return {
                id: child.link.id,
                title: child.link.title,
                href: child.link.href,
                onClick: makeOnClick(child.link.id),
              };
            }
            return null;
          })
          .filter(Boolean) as TopLevelItem['children'];

        result.push({
          id: item.category?.id ?? `category-${result.length}`,
          title: item.category?.label ?? '',
          iconType: typeof categoryIcon === 'string' ? categoryIcon : 'apps',
          isActive: children?.some((c) => c?.id === appId) ?? false,
          children,
        });
      } else {
        // Fallback: flatten children as individual icons (existing behavior)
        item.links?.forEach((child) => {
          if (child.itemType === LinkItemType.LINK && child.link.euiIconType) {
            result.push({
              id: child.link.id,
              title: child.link.title,
              iconType: child.link.euiIconType || 'apps',
              isActive: child.link.id === appId,
              href: child.link.href,
              onClick: makeOnClick(child.link.id),
            });
          } else if (child.itemType === LinkItemType.PARENT_LINK && child.link) {
            // Handle PARENT_LINK children (e.g., Anomaly Detection inside Tools)
            const subChildren = child.links
              ?.map((sub) => {
                if (sub.itemType === LinkItemType.LINK) {
                  return {
                    id: sub.link.id,
                    title: sub.link.title,
                    href: sub.link.href,
                    onClick: makeOnClick(sub.link.id),
                  };
                }
                return null;
              })
              .filter(Boolean) as TopLevelItem['children'];

            result.push({
              id: child.link.id,
              title: child.link.title,
              iconType: child.link.euiIconType || 'apps',
              isActive:
                child.link.id === appId || (subChildren?.some((c) => c?.id === appId) ?? false),
              children: subChildren,
            });
          }
        });
      }
    }
  };

  orderedItems.forEach(processLinkItem);
  return result;
}

function CollapsedNavStripItem({ item }: { item: TopLevelItem }) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  if (item.children && item.children.length > 0) {
    const button = (
      <EuiToolTip content={item.title} position="right">
        <EuiButtonIcon
          iconType={item.iconType}
          aria-label={item.title}
          color={item.isActive ? 'primary' : 'text'}
          display={item.isActive ? 'base' : 'empty'}
          onClick={() => setIsPopoverOpen(!isPopoverOpen)}
          className="collapsedNavStripIcon"
          size="m"
        />
      </EuiToolTip>
    );

    return (
      <EuiPopover
        button={button}
        isOpen={isPopoverOpen}
        closePopover={() => setIsPopoverOpen(false)}
        anchorPosition="rightUp"
        panelPaddingSize="s"
      >
        <EuiListGroup flush maxWidth={240}>
          {item.children.map((child) => (
            <EuiListGroupItem
              key={child.id}
              label={child.title}
              href={child.href}
              onClick={(e) => {
                child.onClick?.(e);
                setIsPopoverOpen(false);
              }}
              size="s"
            />
          ))}
        </EuiListGroup>
      </EuiPopover>
    );
  }

  return (
    <EuiToolTip content={item.title} position="right">
      <EuiButtonIcon
        iconType={item.iconType}
        aria-label={item.title}
        color={item.isActive ? 'primary' : 'text'}
        display={item.isActive ? 'base' : 'empty'}
        href={item.href}
        onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
          item.onClick?.(e);
        }}
        className="collapsedNavStripIcon"
        size="m"
      />
    </EuiToolTip>
  );
}

export function CollapsedNavStrip({ navLinks, appId, navigateToApp }: CollapsedNavStripProps) {
  const topLevelItems = collectTopLevelItems(navLinks, appId, navigateToApp);

  return (
    <EuiFlexGroup
      direction="column"
      alignItems="center"
      gutterSize="s"
      className="collapsedNavStrip"
      responsive={false}
    >
      {topLevelItems.map((item) => (
        <EuiFlexItem key={item.id} grow={false}>
          <CollapsedNavStripItem item={item} />
        </EuiFlexItem>
      ))}
    </EuiFlexGroup>
  );
}

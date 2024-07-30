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
import {
  EuiHeader,
  EuiHeaderProps,
  EuiHeaderSection,
  EuiHeaderSectionItem,
  EuiHeaderSectionItemButton,
  EuiHideFor,
  EuiIcon,
  EuiShowFor,
  EuiText,
  htmlIdGenerator,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import classnames from 'classnames';
import React, { createRef, useMemo, useState } from 'react';
import useObservable from 'react-use/lib/useObservable';
import { Observable } from 'rxjs';
import { LoadingIndicator } from '../';
import {
  ChromeBadge,
  ChromeBreadcrumb,
  ChromeNavControl,
  ChromeNavLink,
  ChromeRecentlyAccessedHistoryItem,
} from '../..';
import type { Logos } from '../../../../common/types';
import { WorkspaceObject } from '../../../../public/workspace';
import { InternalApplicationStart } from '../../../application/types';
import { HttpStart } from '../../../http';
import { getOsdSidecarPaddingStyle, ISidecarConfig } from '../../../overlays';
import {
  ChromeBranding,
  ChromeBreadcrumbEnricher,
  ChromeHelpExtension,
} from '../../chrome_service';
import { ChromeNavGroupServiceStartContract, NavGroupItemInMap } from '../../nav_group';
import { OnIsLockedUpdate } from './';
import { CollapsibleNav } from './collapsible_nav';
import { CollapsibleNavGroupEnabled } from './collapsible_nav_group_enabled';
import './header.scss';
import { HeaderActionMenu } from './header_action_menu';
import { HeaderBadge } from './header_badge';
import { HeaderBreadcrumbs } from './header_breadcrumbs';
import { HeaderHelpMenu } from './header_help_menu';
import { HeaderLogo } from './header_logo';
import { HeaderNavControls } from './header_nav_controls';
import { HomeLoader } from './home_loader';
import { RecentItems } from './recent_items';

export interface HeaderProps {
  opensearchDashboardsVersion: string;
  application: InternalApplicationStart;
  appTitle$: Observable<string>;
  badge$: Observable<ChromeBadge | undefined>;
  breadcrumbs$: Observable<ChromeBreadcrumb[]>;
  breadcrumbsEnricher$: Observable<ChromeBreadcrumbEnricher | undefined>;
  collapsibleNavHeaderRender?: () => JSX.Element | null;
  customNavLink$: Observable<ChromeNavLink | undefined>;
  homeHref: string;
  isVisible$: Observable<boolean>;
  opensearchDashboardsDocLink: string;
  navLinks$: Observable<ChromeNavLink[]>;
  recentlyAccessed$: Observable<ChromeRecentlyAccessedHistoryItem[]>;
  forceAppSwitcherNavigation$: Observable<boolean>;
  helpExtension$: Observable<ChromeHelpExtension | undefined>;
  helpSupportUrl$: Observable<string>;
  navControlsLeft$: Observable<readonly ChromeNavControl[]>;
  navControlsCenter$: Observable<readonly ChromeNavControl[]>;
  navControlsRight$: Observable<readonly ChromeNavControl[]>;
  navControlsExpandedCenter$: Observable<readonly ChromeNavControl[]>;
  navControlsExpandedRight$: Observable<readonly ChromeNavControl[]>;
  navControlsLeftBottom$: Observable<readonly ChromeNavControl[]>;
  basePath: HttpStart['basePath'];
  isLocked$: Observable<boolean>;
  loadingCount$: ReturnType<HttpStart['getLoadingCount$']>;
  onIsLockedUpdate: OnIsLockedUpdate;
  branding: ChromeBranding;
  logos: Logos;
  survey: string | undefined;
  sidecarConfig$: Observable<ISidecarConfig | undefined>;
  navGroupEnabled: boolean;
  currentNavGroup$: Observable<NavGroupItemInMap | undefined>;
  navGroupsMap$: Observable<Record<string, NavGroupItemInMap>>;
  setCurrentNavGroup: ChromeNavGroupServiceStartContract['setCurrentNavGroup'];
  workspaceList$: Observable<WorkspaceObject[]>;
}

export function Header({
  opensearchDashboardsVersion,
  opensearchDashboardsDocLink,
  application,
  basePath,
  onIsLockedUpdate,
  homeHref,
  branding,
  survey,
  logos,
  collapsibleNavHeaderRender,
  navGroupEnabled,
  setCurrentNavGroup,
  ...observables
}: HeaderProps) {
  const isVisible = useObservable(observables.isVisible$, false);
  const isLocked = useObservable(observables.isLocked$, false);
  const appId = useObservable(application.currentAppId$, '');
  const [isNavOpen, setIsNavOpen] = useState(false);
  const sidecarConfig = useObservable(observables.sidecarConfig$, undefined);

  /**
   * This is a workaround on 2.16 to hide the navigation items within left navigation
   * when user is in homepage with workspace enabled + new navigation enabled
   */
  const shouldHideExpandIcon =
    navGroupEnabled && appId === 'home' && application.capabilities.workspaces.enabled;

  const sidecarPaddingStyle = useMemo(() => {
    return getOsdSidecarPaddingStyle(sidecarConfig);
  }, [sidecarConfig]);

  if (!isVisible) {
    return <LoadingIndicator loadingCount$={observables.loadingCount$} showAsBar />;
  }

  const toggleCollapsibleNavRef = createRef<HTMLButtonElement & { euiAnimate: () => void }>();
  const navId = htmlIdGenerator()();
  const className = classnames('hide-for-sharing', 'headerGlobalNav');
  const { useExpandedHeader = true } = branding;

  const expandedHeaderColorScheme: EuiHeaderProps['theme'] = 'dark';

  // let applicationHeader = observables.breadcrumbs$.subscribe((crumbs) => {
  //   return crumbs.pop()!.text;
  // });
  // const [crumbs, setCrumbs] = useState<EuiBreadcrumb[]>([]);

  // const subscription = observables.breadcrumbs$.subscribe({
  //   next: (val) => setCrumbs(val),
  //   error: (err) => console.error(err),
  //   complete: () => console.log('Observable completed'),
  // });

  return (
    <>
      <header className={className} data-test-subj="headerGlobalNav">
        <div id="globalHeaderBars">
          {useExpandedHeader && (
            <EuiHeader
              className="expandedHeader"
              theme={expandedHeaderColorScheme}
              style={sidecarPaddingStyle}
              position="fixed"
              sections={[
                {
                  items: [
                    <HeaderLogo
                      href={homeHref}
                      forceNavigation$={observables.forceAppSwitcherNavigation$}
                      navLinks$={observables.navLinks$}
                      navigateToApp={application.navigateToApp}
                      branding={branding}
                      logos={logos}
                      /* This color-scheme should match the `theme` of the parent EuiHeader */
                      backgroundColorScheme={expandedHeaderColorScheme}
                    />,
                  ],
                  borders: 'none',
                },
                {
                  items: [
                    <EuiShowFor sizes={['m', 'l', 'xl']}>
                      <HeaderNavControls navControls$={observables.navControlsExpandedCenter$} />
                    </EuiShowFor>,
                  ],
                  borders: 'none',
                },
                {
                  items: [
                    <EuiHideFor sizes={['m', 'l', 'xl']}>
                      <HeaderNavControls navControls$={observables.navControlsExpandedCenter$} />
                    </EuiHideFor>,
                    <HeaderNavControls navControls$={observables.navControlsExpandedRight$} />,
                  ],
                  borders: 'none',
                },
              ]}
            />
          )}

          {!navGroupEnabled ? (
            <EuiHeader position="fixed" className="primaryHeader" style={sidecarPaddingStyle}>
              <EuiHeaderSection grow={false}>
                {shouldHideExpandIcon ? null : (
                  <EuiHeaderSectionItem border="right" className="header__toggleNavButtonSection">
                    <EuiHeaderSectionItemButton
                      data-test-subj="toggleNavButton"
                      aria-label={i18n.translate('core.ui.primaryNav.toggleNavAriaLabel', {
                        defaultMessage: 'Toggle primary navigation',
                      })}
                      onClick={() => setIsNavOpen(!isNavOpen)}
                      aria-expanded={isNavOpen}
                      aria-pressed={isNavOpen}
                      aria-controls={navId}
                      ref={toggleCollapsibleNavRef}
                    >
                      <EuiIcon
                        type="menu"
                        size="m"
                        title={i18n.translate('core.ui.primaryNav.menu', {
                          defaultMessage: 'Menu',
                        })}
                      />
                    </EuiHeaderSectionItemButton>
                  </EuiHeaderSectionItem>
                )}

                {/* nav controls left */}
                <EuiHeaderSectionItem border="right">
                  <HeaderNavControls side="left" navControls$={observables.navControlsLeft$} />
                </EuiHeaderSectionItem>

                {/* Home loader left */}
                <EuiHeaderSectionItem border="right">
                  <HomeLoader
                    href={homeHref}
                    forceNavigation$={observables.forceAppSwitcherNavigation$}
                    navLinks$={observables.navLinks$}
                    navigateToApp={application.navigateToApp}
                    branding={branding}
                    logos={logos}
                    loadingCount$={observables.loadingCount$}
                  />
                </EuiHeaderSectionItem>

                {/* recent items */}
                {/* Only display recent items when navGroup is enabled */}
                {navGroupEnabled && (
                  <EuiHeaderSectionItem border="right">
                    <RecentItems
                      recentlyAccessed$={observables.recentlyAccessed$}
                      workspaceList$={observables.workspaceList$}
                      navigateToUrl={application.navigateToUrl}
                      navLinks$={observables.navLinks$}
                      basePath={basePath}
                    />
                  </EuiHeaderSectionItem>
                )}
              </EuiHeaderSection>

              {/* breadcrumbs */}
              <HeaderBreadcrumbs
                appTitle$={observables.appTitle$}
                breadcrumbs$={observables.breadcrumbs$}
                breadcrumbsEnricher$={observables.breadcrumbsEnricher$}
              />

              {/* nav controls badge */}
              <EuiHeaderSectionItem border="none">
                <HeaderBadge badge$={observables.badge$} />
              </EuiHeaderSectionItem>

              {/* nav actions menu only for datasources */}
              <EuiHeaderSection side="right">
                <EuiHeaderSectionItem border="none">
                  <HeaderActionMenu actionMenu$={application.currentActionMenu$} />
                </EuiHeaderSectionItem>

                {/* nav controls center*/}
                <EuiHeaderSectionItem border="left">
                  <HeaderNavControls navControls$={observables.navControlsCenter$} />
                </EuiHeaderSectionItem>

                {/* nav controls center right*/}
                <EuiHeaderSectionItem border="left">
                  <HeaderNavControls side="right" navControls$={observables.navControlsRight$} />
                </EuiHeaderSectionItem>

                {/* nav help section*/}
                <EuiHeaderSectionItem border="left">
                  <HeaderHelpMenu
                    helpExtension$={observables.helpExtension$}
                    helpSupportUrl$={observables.helpSupportUrl$}
                    opensearchDashboardsDocLink={opensearchDashboardsDocLink}
                    opensearchDashboardsVersion={opensearchDashboardsVersion}
                    surveyLink={survey}
                  />
                </EuiHeaderSectionItem>
              </EuiHeaderSection>
            </EuiHeader>
          ) : (
            <div>
              <EuiHeader
                position="fixed"
                className="primaryHeader newTopNavHeader"
                style={sidecarPaddingStyle}
              >
                <EuiHeaderSection grow={false}>
                  {shouldHideExpandIcon ? null : (
                    <EuiHeaderSectionItem border="right" className="header__toggleNavButtonSection">
                      <EuiHeaderSectionItemButton
                        data-test-subj="toggleNavButton"
                        aria-label={i18n.translate('core.ui.primaryNav.toggleNavAriaLabel', {
                          defaultMessage: 'Toggle primary navigation',
                        })}
                        onClick={() => setIsNavOpen(!isNavOpen)}
                        aria-expanded={isNavOpen}
                        aria-pressed={isNavOpen}
                        aria-controls={navId}
                        ref={toggleCollapsibleNavRef}
                      >
                        <EuiIcon
                          type="menu"
                          size="m"
                          title={i18n.translate('core.ui.primaryNav.menu', {
                            defaultMessage: 'Menu',
                          })}
                        />
                      </EuiHeaderSectionItemButton>
                    </EuiHeaderSectionItem>
                  )}

                  {/* recent items */}
                  {/* Only display recent items when navGroup is enabled */}
                  {navGroupEnabled && (
                    <EuiHeaderSectionItem>
                      <RecentItems
                        recentlyAccessed$={observables.recentlyAccessed$}
                        workspaceList$={observables.workspaceList$}
                        navigateToUrl={application.navigateToUrl}
                        navLinks$={observables.navLinks$}
                        basePath={basePath}
                      />
                    </EuiHeaderSectionItem>
                  )}
                </EuiHeaderSection>

                {/* breadcrumbs */}
                <HeaderBreadcrumbs
                  appTitle$={observables.appTitle$}
                  breadcrumbs$={observables.breadcrumbs$}
                  breadcrumbsEnricher$={observables.breadcrumbsEnricher$}
                />
              </EuiHeader>

              {/* Second header */}
              <EuiHeader className="newTopNavHeader">
                <EuiHeaderSection side="left">
                  <EuiHeaderSectionItem border="none">
                    <EuiText>
                      <h2>Application Title</h2>
                    </EuiText>
                  </EuiHeaderSectionItem>

                  {/* nav controls badge */}
                  <EuiHeaderSectionItem border="none">
                    <HeaderBadge badge$={observables.badge$} />
                  </EuiHeaderSectionItem>

                  {/* nav controls left */}
                  <EuiHeaderSectionItem border="none">
                    <HeaderNavControls side="left" navControls$={observables.navControlsLeft$} />
                  </EuiHeaderSectionItem>
                </EuiHeaderSection>

                <EuiHeaderSection side="right">
                  {/* nav controls center*/}
                  <EuiHeaderSectionItem border="none">
                    <HeaderNavControls navControls$={observables.navControlsCenter$} />
                  </EuiHeaderSectionItem>

                  {/* nav actions menu only for datasources */}
                  <EuiHeaderSectionItem border="none">
                    <HeaderActionMenu actionMenu$={application.currentActionMenu$} />
                  </EuiHeaderSectionItem>

                  {/* nav controls center right*/}
                  {/* contains security item and appearence item */}
                  <EuiHeaderSectionItem border="none">
                    <HeaderNavControls side="right" navControls$={observables.navControlsRight$} />
                  </EuiHeaderSectionItem>
                </EuiHeaderSection>
              </EuiHeader>
            </div>
          )}
        </div>

        {navGroupEnabled ? (
          <CollapsibleNavGroupEnabled
            appId$={application.currentAppId$}
            id={navId}
            isLocked={isLocked}
            navLinks$={observables.navLinks$}
            isNavOpen={shouldHideExpandIcon ? false : isNavOpen}
            basePath={basePath}
            navigateToApp={application.navigateToApp}
            navigateToUrl={application.navigateToUrl}
            onIsLockedUpdate={onIsLockedUpdate}
            closeNav={() => {
              setIsNavOpen(false);
              if (toggleCollapsibleNavRef.current) {
                toggleCollapsibleNavRef.current.focus();
              }
            }}
            customNavLink$={observables.customNavLink$}
            logos={logos}
            navGroupsMap$={observables.navGroupsMap$}
            navControlsLeftBottom$={observables.navControlsLeftBottom$}
            currentNavGroup$={observables.currentNavGroup$}
            setCurrentNavGroup={setCurrentNavGroup}
            capabilities={application.capabilities}
          />
        ) : (
          <CollapsibleNav
            appId$={application.currentAppId$}
            collapsibleNavHeaderRender={collapsibleNavHeaderRender}
            id={navId}
            isLocked={isLocked}
            navLinks$={observables.navLinks$}
            recentlyAccessed$={observables.recentlyAccessed$}
            isNavOpen={isNavOpen}
            homeHref={homeHref}
            basePath={basePath}
            navigateToApp={application.navigateToApp}
            navigateToUrl={application.navigateToUrl}
            onIsLockedUpdate={onIsLockedUpdate}
            closeNav={() => {
              setIsNavOpen(false);
              if (toggleCollapsibleNavRef.current) {
                toggleCollapsibleNavRef.current.focus();
              }
            }}
            customNavLink$={observables.customNavLink$}
            logos={logos}
          />
        )}
      </header>
    </>
  );
}

/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { BehaviorSubject, Observable } from 'rxjs';
import { AgentTracesPlugin, isTimeOrRefreshChange } from './plugin';
import { AppNavLinkStatus, AppUpdater } from '../../../core/public';
import { createOsdUrlTracker } from '../../opensearch_dashboards_utils/public';
import { agentEvalsNavPopover } from './nav_popover';
import { AGENT_EVALS_NAV_ID } from '../common';
import { coreMock } from '../../../core/public/mocks';
import { CoreSetup, CoreStart } from 'opensearch-dashboards/public';
import {
  AgentTracesPluginStart,
  AgentTracesSetupDependencies,
  AgentTracesStartDependencies,
} from './types';
import { DataPublicPluginSetup, DataPublicPluginStart } from '../../data/public';
import { UrlForwardingSetup, UrlForwardingStart } from '../../url_forwarding/public';
import { EmbeddableSetup, EmbeddableStart } from '../../embeddable/public';
import { VisualizationsSetup, VisualizationsStart } from '../../visualizations/public';
import { UiActionsSetup, UiActionsStart } from '../../ui_actions/public';
import { NavigationPublicPluginStart as NavigationStart } from '../../navigation/public';
import {
  OpenSearchDashboardsLegacySetup,
  OpenSearchDashboardsLegacyStart,
} from '../../opensearch_dashboards_legacy/public';
import { UsageCollectionSetup } from '../../usage_collection/public';
import { ExpressionsPublicPlugin, ExpressionsStart } from '../../expressions/public';
import { DashboardSetup, DashboardStart } from '../../dashboard/public';
import { ChartsPluginStart } from '../../charts/public';
import { Start as InspectorPublicPluginStart } from '../../inspector/public';
import { ContextProviderStart } from '../../context_provider/public';

// Mock log action registry
jest.mock('./services/log_action_registry', () => ({
  logActionRegistry: {
    registerAction: jest.fn(),
  },
}));

// Mock createAskAiAction
jest.mock('./actions/ask_ai_action', () => ({
  createAskAiAction: jest.fn().mockReturnValue({
    id: 'ask_ai',
    execute: jest.fn(),
  }),
}));

// Mock createOsdUrlTracker
jest.mock('../../opensearch_dashboards_utils/public', () => ({
  ...jest.requireActual('../../opensearch_dashboards_utils/public'),
  createOsdUrlTracker: jest.fn(() => ({
    appMounted: jest.fn(),
    appUnMounted: jest.fn(),
    stop: jest.fn(),
  })),
}));

describe('AgentTracesPlugin', () => {
  let plugin: AgentTracesPlugin;
  let initializerContext: ReturnType<typeof createMockInitializerContext>;
  let coreSetup: CoreSetup<AgentTracesStartDependencies, AgentTracesPluginStart>;
  let coreStart: CoreStart;
  let setupDeps: AgentTracesSetupDependencies;
  let startDeps: AgentTracesStartDependencies;

  function createMockInitializerContext() {
    return {
      config: {
        get: jest.fn().mockReturnValue({}),
      },
      logger: {
        get: jest.fn().mockReturnValue({
          debug: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        }),
      },
      env: {
        packageInfo: {
          version: '1.0.0',
        },
      },
    };
  }

  function createMockSetupDeps(): AgentTracesSetupDependencies {
    return {
      data: {
        __enhance: jest.fn(),
        query: {
          state$: {
            pipe: jest.fn().mockReturnValue({
              subscribe: jest.fn(),
            }),
          },
        },
      } as unknown as DataPublicPluginSetup,
      urlForwarding: {
        forwardApp: jest.fn(),
      } as Partial<UrlForwardingSetup> as UrlForwardingSetup,
      embeddable: {
        registerEmbeddableFactory: jest.fn(),
      } as Partial<EmbeddableSetup> as EmbeddableSetup,
      visualizations: {
        registerAlias: jest.fn(),
        all: jest.fn().mockReturnValue([]),
        getAliases: jest.fn().mockReturnValue([]),
      } as Partial<VisualizationsSetup> as VisualizationsSetup,
      uiActions: {
        getTriggerActions: jest.fn().mockReturnValue([]),
      } as Partial<UiActionsSetup> as UiActionsSetup,
      navigation: {} as NavigationStart,
      opensearchDashboardsLegacy: {} as OpenSearchDashboardsLegacySetup,
      usageCollection: {} as UsageCollectionSetup,
      expressions: {} as ReturnType<ExpressionsPublicPlugin['setup']>,
      dashboard: {} as DashboardSetup,
    };
  }

  function createMockStartDeps(): AgentTracesStartDependencies {
    return {
      data: {
        indexPatterns: {},
        dataViews: {},
        search: {},
        query: {
          filterManager: {},
          timefilter: {
            timefilter: {},
          },
          queryString: {
            clearQuery: jest.fn(),
          },
        },
      } as unknown as DataPublicPluginStart,
      uiActions: {
        registerAction: jest.fn(),
        addTriggerAction: jest.fn(),
        detachAction: jest.fn(),
        executeTriggerActions: jest.fn(),
        registerTrigger: jest.fn(),
        getTrigger: jest.fn(),
        getTriggers: jest.fn(),
        unregisterAction: jest.fn(),
        attachAction: jest.fn(),
        getAction: jest.fn(),
        hasAction: jest.fn(),
      } as Partial<UiActionsStart> as UiActionsStart,
      dashboard: {} as DashboardStart,
      expressions: {
        ExpressionLoader: jest.fn(),
      } as Partial<ExpressionsStart> as ExpressionsStart,
      charts: {
        theme: {},
      } as Partial<ChartsPluginStart> as ChartsPluginStart,
      navigation: {} as NavigationStart,
      inspector: {} as InspectorPublicPluginStart,
      urlForwarding: {} as UrlForwardingStart,
      embeddable: {} as EmbeddableStart,
      opensearchDashboardsLegacy: {} as OpenSearchDashboardsLegacyStart,
      contextProvider: {
        getAssistantContextStore: jest.fn().mockReturnValue({
          addContext: jest.fn(),
        }),
      } as Partial<ContextProviderStart> as ContextProviderStart,
      visualizations: {
        all: jest.fn().mockReturnValue([]),
        getAliases: jest.fn().mockReturnValue([]),
      } as Partial<VisualizationsStart> as VisualizationsStart,
    };
  }

  beforeEach(() => {
    // Mock initializer context
    initializerContext = createMockInitializerContext();

    // Mock core setup
    coreSetup = coreMock.createSetup();
    coreSetup.getStartServices = jest.fn().mockResolvedValue([
      coreMock.createStart(),
      {
        data: {
          indexPatterns: {
            clearCache: jest.fn(),
          },
          query: {
            queryString: {
              clearQuery: jest.fn(),
            },
          },
        },
        uiActions: {
          getTriggerActions: jest.fn().mockReturnValue([]),
        },
        visualizations: {
          all: jest.fn().mockReturnValue([]),
          getAliases: jest.fn().mockReturnValue([]),
        },
      },
    ]);

    // Mock core start
    coreStart = coreMock.createStart();
    // Add workspaces mock with proper BehaviorSubject-like structure
    Object.defineProperty(coreStart, 'workspaces', {
      value: {
        currentWorkspace$: {
          pipe: jest.fn().mockReturnValue({
            toPromise: jest.fn().mockResolvedValue({
              features: ['observability'],
            }),
          }),
          subscribe: jest.fn(),
          getValue: jest.fn(),
          next: jest.fn(),
        },
      },
      writable: true,
      configurable: true,
    });

    // Mock setup dependencies
    setupDeps = createMockSetupDeps();

    // Mock start dependencies
    startDeps = createMockStartDeps();

    plugin = new AgentTracesPlugin(initializerContext as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('setup', () => {
    it('should register agent traces applications', () => {
      plugin.setup(coreSetup as any, setupDeps as any);

      // Classic navigation: Evaluations and the base app.
      expect(coreSetup.application.register).toHaveBeenCalledTimes(2);
      expect(coreSetup.application.register).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'agentTraces',
        })
      );
    });

    it('should register embeddable factory', () => {
      plugin.setup(coreSetup, setupDeps);

      expect(setupDeps.embeddable.registerEmbeddableFactory).toHaveBeenCalledWith(
        'agentTraces',
        expect.any(Object)
      );
    });

    it('should not register visualization alias', () => {
      plugin.setup(coreSetup, setupDeps);

      expect(setupDeps.visualizations.registerAlias).not.toHaveBeenCalled();
    });

    it('should register the main app with updater observable', () => {
      plugin.setup(coreSetup, setupDeps);

      expect(coreSetup.application.register).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'agentTraces',
        })
      );
    });

    it('registers Evaluations first in Agent monitoring, with its popover (icon side nav)', () => {
      (coreSetup.chrome.getIsIconSideNavEnabled as jest.Mock).mockReturnValue(true);
      plugin.setup(coreSetup, setupDeps);
      const calls = (coreSetup.chrome.navGroup.addNavLinksToGroup as jest.Mock).mock.calls;
      const links = calls.flatMap((c) => c[1] as Array<{ id: string; order?: number }>);
      const evals = links.find((l) => l.id === AGENT_EVALS_NAV_ID) as
        { order?: number; navPopover?: unknown } | undefined;
      expect(evals?.order).toBe(50);
      expect(evals?.navPopover).toBe(agentEvalsNavPopover);
      const others = links.filter((l) => l.id !== AGENT_EVALS_NAV_ID && l.order !== undefined);
      expect(others.every((l) => (l.order as number) > 50)).toBe(true);
    });

    const registeredIds = () =>
      (coreSetup.application.register as jest.Mock).mock.calls.map((c) => c[0].id as string);

    it.each([
      ['classic', false],
      ['icon side', true],
    ])('registers Evaluations before the base app (%s nav)', (_mode, iconSideNav) => {
      (coreSetup.chrome.getIsIconSideNavEnabled as jest.Mock).mockReturnValue(iconSideNav);
      plugin.setup(coreSetup, setupDeps);
      const ids = registeredIds();
      expect(ids).toContain(AGENT_EVALS_NAV_ID);
      // parseAppUrl takes the first app whose id is a prefix of the URL.
      expect(ids.indexOf(AGENT_EVALS_NAV_ID)).toBeLessThan(ids.indexOf('agentTraces'));
    });

    it('adds the Evaluations nav link right after Agent Traces (classic nav)', () => {
      (coreSetup.chrome.getIsIconSideNavEnabled as jest.Mock).mockReturnValue(false);
      plugin.setup(coreSetup, setupDeps);
      const calls = (coreSetup.chrome.navGroup.addNavLinksToGroup as jest.Mock).mock.calls;
      const groupsWith = (id: string) =>
        calls
          .filter((c) => (c[1] as Array<{ id: string }>).some((l) => l.id === id))
          .map((c) => c[0].id);
      expect(groupsWith(AGENT_EVALS_NAV_ID).sort()).toEqual(groupsWith('agentTraces').sort());
      const link = calls
        .flatMap((c) => c[1] as Array<{ id: string; order?: number; category?: unknown }>)
        .find((l) => l.id === AGENT_EVALS_NAV_ID);
      expect(link).toEqual(expect.objectContaining({ order: 301, category: undefined }));
    });

    it('should register nav links during setup', () => {
      plugin.setup(coreSetup, setupDeps);

      expect(coreSetup.chrome.navGroup.addNavLinksToGroup).toHaveBeenCalledWith(
        expect.any(Object),
        expect.arrayContaining([expect.objectContaining({ id: 'agentTraces' })])
      );
    });
  });

  describe('start', () => {
    beforeEach(() => {
      plugin.setup(coreSetup, setupDeps);
    });

    it('should create saved agent traces loader', () => {
      const result = plugin.start(coreStart, startDeps);

      expect(result.savedAgentTracesLoader).toBeDefined();
      expect(result.savedSearchLoader).toBeDefined();
      expect(result.savedSearchLoader).toBe(result.savedAgentTracesLoader);
    });

    it('should return slot registry', () => {
      const result = plugin.start(coreStart, startDeps);

      expect(result.slotRegistry).toBeDefined();
    });
  });

  describe('nav link visibility', () => {
    const latestUpdater = (appId: string): AppUpdater => {
      const app = (coreSetup.application.register as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((a) => a.id === appId);
      let latest: AppUpdater = () => ({});
      const sub = (app.updater$ as Observable<AppUpdater>).subscribe((u) => (latest = u));
      sub.unsubscribe();
      return latest;
    };
    const trackerSubjectFor = (appId: string) =>
      (createOsdUrlTracker as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((o) => String(o.storageKey).endsWith(`:${appId}`))
        .navLinkUpdater$ as BehaviorSubject<AppUpdater>;

    beforeEach(() => {
      (coreSetup.chrome.getIsIconSideNavEnabled as jest.Mock).mockReturnValue(true);
      plugin.setup(coreSetup, setupDeps);
    });

    it('keeps Evaluations hidden with the flag off after a time change updates the default path', () => {
      plugin.start(coreStart, startDeps);
      const app = { id: AGENT_EVALS_NAV_ID } as any;
      expect(latestUpdater(AGENT_EVALS_NAV_ID)(app)).toEqual(
        expect.objectContaining({ navLinkStatus: AppNavLinkStatus.hidden })
      );
      // What the URL tracker does on a time or refresh change.
      trackerSubjectFor(AGENT_EVALS_NAV_ID).next(() => ({ defaultPath: '#/?_g=(time:x)' }));
      expect(latestUpdater(AGENT_EVALS_NAV_ID)(app)).toEqual({
        navLinkStatus: AppNavLinkStatus.hidden,
        defaultPath: '#/?_g=(time:x)',
      });
    });

    it('keeps the base app hidden when Agent Traces is off and its tracker emits', () => {
      plugin.start(coreStart, startDeps);
      trackerSubjectFor('agentTraces').next(() => ({ defaultPath: '#/x' }));
      expect(latestUpdater('agentTraces')({ id: 'agentTraces' } as any)).toEqual({
        navLinkStatus: AppNavLinkStatus.hidden,
        defaultPath: '#/x',
      });
    });

    it('keeps Evaluations hidden with the flag off in the classic nav', () => {
      const classic = new AgentTracesPlugin(initializerContext as any);
      (coreSetup.application.register as jest.Mock).mockClear();
      (createOsdUrlTracker as jest.Mock).mockClear();
      (coreSetup.chrome.getIsIconSideNavEnabled as jest.Mock).mockReturnValue(false);
      classic.setup(coreSetup, setupDeps);
      classic.start(coreStart, startDeps);
      trackerSubjectFor(AGENT_EVALS_NAV_ID).next(() => ({ defaultPath: '#/z' }));
      expect(latestUpdater(AGENT_EVALS_NAV_ID)({ id: AGENT_EVALS_NAV_ID } as any)).toEqual({
        navLinkStatus: AppNavLinkStatus.hidden,
        defaultPath: '#/z',
      });
    });

    it('shows Evaluations when the capability is on', () => {
      (coreStart.application as any).capabilities = {
        agentTraces: { agentTracesEnabled: true, agentEvalsEnabled: true },
      };
      plugin.start(coreStart, startDeps);
      trackerSubjectFor(AGENT_EVALS_NAV_ID).next(() => ({ defaultPath: '#/y' }));
      expect(latestUpdater(AGENT_EVALS_NAV_ID)({ id: AGENT_EVALS_NAV_ID } as any)).toEqual({
        navLinkStatus: AppNavLinkStatus.visible,
        defaultPath: '#/y',
      });
    });
  });

  describe('stop', () => {
    it('should call stop callbacks without errors', () => {
      plugin.setup(coreSetup, setupDeps);
      plugin.start(coreStart, startDeps);

      expect(() => plugin.stop()).not.toThrow();
    });
  });
});

describe('isTimeOrRefreshChange', () => {
  it('is true for a time or refresh interval change only', () => {
    expect(isTimeOrRefreshChange({ changes: { time: true } })).toBe(true);
    expect(isTimeOrRefreshChange({ changes: { refreshInterval: true } })).toBe(true);
    expect(isTimeOrRefreshChange({ changes: { filters: true } })).toBe(false);
    expect(isTimeOrRefreshChange({ changes: {} })).toBe(false);
    expect(isTimeOrRefreshChange({})).toBe(false);
  });
});

/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import './eval_components.scss';

import React from 'react';
import {
  EuiBadge,
  EuiButtonGroup,
  EuiLink,
  EuiSelectable,
  EuiSelectableOption,
  EuiCallOut,
  EuiIconTip,
  EuiScreenReaderOnly,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { CaseStatus, EvalResult, MIN_N, RunRow, Tally, Verdict } from './eval_model';
import { AGG_LIMIT, EvalSource, NO_AGENT } from './eval_ppl';
import { formatInZone } from './eval_time';
import { ResultTarget, targetOf } from './eval_links';

export const VERDICT_LABEL: Record<Verdict, string> = {
  pass: i18n.translate('agentTraces.evals.verdict.pass', { defaultMessage: 'Pass' }),
  fail: i18n.translate('agentTraces.evals.verdict.fail', { defaultMessage: 'Fail' }),
  error: i18n.translate('agentTraces.evals.verdict.error', { defaultMessage: 'Evaluator error' }),
  scored: i18n.translate('agentTraces.evals.verdict.scored', { defaultMessage: 'Scored' }),
};

const VERDICT_COLOR: Record<Verdict, string> = {
  pass: 'success',
  fail: 'danger',
  error: 'warning',
  scored: 'hollow',
};

export const NO_AGENT_LABEL = i18n.translate('agentTraces.evals.noAgentName', {
  defaultMessage: '(no agent name)',
});

export const agentLabel = (agent?: string) =>
  !agent || agent === NO_AGENT ? NO_AGENT_LABEL : agent;

export const NO_VERSION_LABEL = i18n.translate('agentTraces.evals.noVersion', {
  defaultMessage: '(no version)',
});

/** A version key ('' or `~none`: results without `gen_ai.agent.version`) as shown. */
export const versionLabel = (version?: string) =>
  !version || version === NO_AGENT ? NO_VERSION_LABEL : version;

export const DASH = '—';

export const pct = (x?: number) => (x === undefined ? DASH : `${Math.round(x * 100)}%`);

export const formatTime = (ms: number, format = 'MMM D, HH:mm') =>
  Number.isFinite(ms) ? formatInZone(ms, format) : DASH;

export const formatDay = (ms: number) => formatTime(ms, 'MMM D');

/** A chart slice: `Oct 30, 21:00 to 00:00`. */
export const sliceLabel = (from: number, to: number) =>
  i18n.translate('agentTraces.evals.sliceLabel', {
    defaultMessage: '{from} to {to}',
    values: { from: formatTime(from), to: formatTime(to, 'HH:mm') },
  });

export const formatDuration = (ms: number) => {
  if (!Number.isFinite(ms) || ms < 0) return DASH;
  if (ms < 1000)
    return i18n.translate('agentTraces.evals.duration.ms', {
      defaultMessage: '{ms} ms',
      values: { ms: Math.round(ms) },
    });
  if (ms < 60e3)
    return i18n.translate('agentTraces.evals.duration.s', {
      defaultMessage: '{s} s',
      values: { s: (ms / 1000).toFixed(1) },
    });
  if (ms < 3600e3)
    return i18n.translate('agentTraces.evals.duration.minS', {
      defaultMessage: '{min} min {s} s',
      values: { min: Math.floor(ms / 60e3), s: Math.round((ms % 60e3) / 1000) },
    });
  return i18n.translate('agentTraces.evals.duration.hMin', {
    defaultMessage: '{h} h {min} min',
    values: { h: Math.floor(ms / 3600e3), min: Math.round((ms % 3600e3) / 60e3) },
  });
};

/** The short form of an id: a run id's last part (`run_<date>_<hex>`), 8 characters. */
export const shortId = (id?: string, size = 8) =>
  id ? (id.split('_').pop() ?? id).slice(0, size) : '';

/** A run as people name it: its name (`opensearch.test.suite.run.name`), else its short id. */
export const runLabel = (r: { runId: string; name?: string }) => r.name ?? shortId(r.runId);

export const formatScore = (value?: number) =>
  value === undefined ? DASH : Number.isInteger(value) ? String(value) : value.toFixed(2);

/** A result's score, else the label of a scored result. */
export const scoreOrLabel = (r: { value?: number; label?: string; verdict: Verdict }) =>
  r.value !== undefined ? formatScore(r.value) : r.label && r.verdict === 'scored' ? r.label : DASH;

/**
 * The scale of a score: declared min / max, else 0 to 1 for a value in [0, 1). A bare 1 is not
 * taken for the top of a 0 to 1 scale: it is as likely the worst score of a 1 to 5 judge, so
 * it shows as a number.
 */
export const scoreScale = (r: { value?: number; scoreMin?: number; scoreMax?: number }) => {
  if (r.value === undefined) return undefined;
  const min =
    r.scoreMin ?? (r.scoreMax === undefined && r.value >= 0 && r.value < 1 ? 0 : undefined);
  const max = r.scoreMax ?? (min === 0 && r.value <= 1 ? 1 : undefined);
  return min !== undefined && max !== undefined && max > min ? { min, max } : undefined;
};

/**
 * Bricks of a scale and how many a value fills: one brick per point on small integer scales
 * (1 to 5: five bricks, a 1 fills one), else 10 by the value's share of the scale.
 */
export const brickCount = ({ min, max }: { min: number; max: number }) =>
  min === 1 && Number.isInteger(max) && max <= 10 ? max : 10;

export const bricksFilled = (value: number, scale: { min: number; max: number }) => {
  const n = brickCount(scale);
  if (scale.min === 1 && n === scale.max) return Math.min(n, Math.max(0, Math.round(value)));
  const share = (value - scale.min) / (scale.max - scale.min);
  return Math.round(Math.min(1, Math.max(0, share)) * n);
};

/**
 * A score as a row of bricks, filled by its share of the scale; the color is the verdict's
 * (score.label from the producer), never a threshold applied here. Unknown scale: the number.
 */
export const ScoreBricks: React.FC<{
  r: { value?: number; label?: string; verdict: Verdict; scoreMin?: number; scoreMax?: number };
  showValue?: boolean;
}> = ({ r, showValue = true }) => {
  const scale = scoreScale(r);
  if (!scale || r.value === undefined) return <span className="agtEvlMono">{scoreOrLabel(r)}</span>;
  const n = brickCount(scale);
  const filled = bricksFilled(r.value, scale);
  const tip = i18n.translate('agentTraces.evals.scoreTip', {
    defaultMessage: '{value} on a {min} to {max} scale',
    values: { value: formatScore(r.value), min: scale.min, max: scale.max },
  });
  return (
    <EuiToolTip content={tip}>
      <span className="agtEvlBricks" data-test-subj="agtEvlScoreBricks">
        <span className={`agtEvlBricks__row agtEvlBricks__row--${r.verdict}`} aria-label={tip}>
          {Array.from({ length: n }, (_, i) => (
            <span
              key={i}
              className={`agtEvlBricks__brick${i < filled ? ' agtEvlBricks__brick--on' : ''}`}
            />
          ))}
        </span>
        {showValue && <span className="agtEvlMono">{formatScore(r.value)}</span>}
      </span>
    </EuiToolTip>
  );
};

export const VerdictBadge: React.FC<{ verdict: Verdict | CaseStatus }> = ({ verdict }) => (
  <EuiBadge color={VERDICT_COLOR[verdict]} data-test-subj={`agtEvlVerdict-${verdict}`}>
    {VERDICT_LABEL[verdict]}
  </EuiBadge>
);

export const VersionBadge: React.FC<{ version?: string }> = ({ version }) =>
  version ? (
    <EuiBadge color="default">{version}</EuiBadge>
  ) : (
    <span className="agtEvlDim">{DASH}</span>
  );

/** A pass rate with a small bar; `bare`: the bar only. */
export const PassRateCell: React.FC<{ rate?: number; bare?: boolean }> = ({ rate, bare }) =>
  rate === undefined ? (
    <span className="agtEvlDim">{DASH}</span>
  ) : (
    <span className="agtEvlRate">
      {!bare && <strong>{pct(rate)}</strong>}
      <span className="agtEvlRate__bar">
        <span className="agtEvlRate__fill" style={{ width: `${Math.round(rate * 100)}%` }} />
      </span>
    </span>
  );

const sampleTip = (na: number, nb: number, low: boolean) =>
  i18n.translate('agentTraces.evals.deltaN', {
    defaultMessage: 'n = {na} vs {nb}',
    values: { na: na.toLocaleString(), nb: nb.toLocaleString() },
  }) +
  (low
    ? i18n.translate('agentTraces.evals.deltaLowN', {
        defaultMessage: '. Fewer than {min} results with a pass rule on one side: treat with care.',
        values: { min: MIN_N },
      })
    : '');

/**
 * A change b - a. Pass rates are in points (3 or more is colored); with `score`, the average
 * score's change (0.05 or more is colored), where `minimize` means lower is better. `na` / `nb`:
 * results with a pass rule behind each side, shown with the change; under 30 on either side the
 * change is greyed.
 */
export const DeltaCell: React.FC<{
  delta?: number;
  na?: number;
  nb?: number;
  score?: { direction?: string };
  /** A fixed set (a suite run's cases): no minimum sample size, never greyed for n. */
  exact?: boolean;
}> = ({ delta, na, nb, score, exact }) => {
  if (delta === undefined) return <span className="agtEvlDim">{DASH}</span>;
  const hasN = na !== undefined && nb !== undefined;
  const low = !exact && hasN && ((na as number) < MIN_N || (nb as number) < MIN_N);
  let text: string;
  let tone: 'bad' | 'good' | 'flat';
  if (score) {
    const better = score.direction === 'minimize' ? delta < 0 : delta > 0;
    const big = Math.abs(delta) >= 0.05;
    tone = low || !big ? 'flat' : better ? 'good' : 'bad';
    const sign = delta > 0 ? '+' : delta < 0 ? '-' : '±';
    text = `${sign}${Math.abs(delta).toFixed(2)}`;
  } else {
    const d = Math.round(delta * 100);
    tone = low || Math.abs(d) < 3 ? 'flat' : d > 0 ? 'good' : 'bad';
    const sign = d > 0 ? '+' : d < 0 ? '-' : '±';
    text = i18n.translate('agentTraces.evals.deltaPoints', {
      defaultMessage: '{sign}{points} pts',
      values: { sign, points: Math.abs(d) },
    });
  }
  const cell = (
    <span
      className={`agtEvlDelta agtEvlDelta--${tone}`}
      data-test-subj={low ? 'agtEvlDeltaLow' : 'agtEvlDelta'}
    >
      {text}
    </span>
  );
  if (!hasN) return cell;
  return (
    <span>
      <EuiToolTip content={sampleTip(na as number, nb as number, low)}>{cell}</EuiToolTip>
      <span className="agtEvlDim agtEvlSmall agtEvlDelta__n">
        {i18n.translate('agentTraces.evals.deltaNShort', {
          defaultMessage: 'n {nb}/{na}',
          values: { na: (na as number).toLocaleString(), nb: (nb as number).toLocaleString() },
        })}
      </span>
    </span>
  );
};

/** Marks a version with results in the last 6 hours. */
export const LiveDot: React.FC = () => (
  <span
    className="agtEvlLiveDot"
    aria-label={i18n.translate('agentTraces.evals.live', {
      defaultMessage: 'Results in the last 6 hours',
    })}
    data-test-subj="agtEvlLiveDot"
  />
);

/** Counts per verdict as colored dots: fail, pass, evaluator error, scored. */
export const TallyCell: React.FC<{ tally: Tally }> = ({ tally }) => {
  const parts: Array<[Verdict, number]> = (['fail', 'pass', 'error', 'scored'] as Verdict[])
    .map((v): [Verdict, number] => [v, tally[v]])
    .filter(([, n]) => n > 0);
  if (!parts.length) return <span className="agtEvlDim">{DASH}</span>;
  return (
    <span className="agtEvlTally" data-test-subj="agtEvlTally">
      {parts.map(([v, n]) => (
        <EuiToolTip key={v} content={`${VERDICT_LABEL[v]}: ${n}`}>
          <span className="agtEvlTally__item">
            <span className={`agtEvlTally__dot agtEvlTally__dot--${v}`} />
            {/* The dot's color, for screen readers (the tally can sit inside a link, so the
                items take no focus of their own). */}
            <EuiScreenReaderOnly>
              <span>{`${VERDICT_LABEL[v]}: `}</span>
            </EuiScreenReaderOnly>
            {n}
          </span>
        </EuiToolTip>
      ))}
    </span>
  );
};

const SOURCE_LABEL: Record<EvalSource, string> = {
  all: i18n.translate('agentTraces.evals.source.all', { defaultMessage: 'All' }),
  online: i18n.translate('agentTraces.evals.source.online', { defaultMessage: 'Online' }),
  offline: i18n.translate('agentTraces.evals.source.offline', { defaultMessage: 'Offline' }),
};

const SOURCE_TIP: Partial<Record<EvalSource, string>> = {
  online: i18n.translate('agentTraces.evals.source.onlineTip', {
    defaultMessage: 'Results on live traffic (no test.suite.run.id)',
  }),
  offline: i18n.translate('agentTraces.evals.source.offlineTip', {
    defaultMessage: 'Results from suite runs (test.suite.run.id set)',
  }),
};

export const SourceFilter: React.FC<{
  value: EvalSource;
  onChange: (source: EvalSource) => void;
}> = ({ value, onChange }) => (
  <div className="agtEvlInline">
    <EuiButtonGroup
      legend={i18n.translate('agentTraces.evals.source.legend', {
        defaultMessage: 'Results source',
      })}
      buttonSize="compressed"
      type="single"
      idSelected={`agtEvlSource-${value}`}
      onChange={(id: string) => onChange(id.replace('agtEvlSource-', '') as EvalSource)}
      options={(['all', 'online', 'offline'] as EvalSource[]).map((s) => ({
        id: `agtEvlSource-${s}`,
        label: SOURCE_LABEL[s],
        title: SOURCE_TIP[s],
        'data-test-subj': `agtEvlSource-${s}`,
      }))}
      data-test-subj="agtEvlSource"
    />
  </div>
);

export const QueryErrorCallout: React.FC<{ message: string }> = ({ message }) => (
  <EuiCallOut
    color="danger"
    iconType="alert"
    size="s"
    title={i18n.translate('agentTraces.evals.queryError', {
      defaultMessage: 'The query failed',
    })}
    data-test-subj="agtEvlQueryError"
  >
    <EuiText size="xs">
      <p>{message}</p>
    </EuiText>
  </EuiCallOut>
);

/**
 * An aggregation hit its row cap (`AGG_LIMIT`): the figures below may miss cases. Shown above
 * them instead of silently counting a cut-off list.
 */
export const TruncatedCallout: React.FC<{ testId?: string }> = ({ testId = 'agtEvlTruncated' }) => (
  <EuiCallOut
    color="warning"
    iconType="alert"
    size="s"
    title={i18n.translate('agentTraces.evals.truncated', {
      defaultMessage: 'Results truncated',
    })}
    data-test-subj={testId}
  >
    <EuiText size="xs">
      <p>
        {i18n.translate('agentTraces.evals.truncatedText', {
          defaultMessage:
            'The query reached its limit of {limit} groups, so some cases or results are not counted. Narrow the range or the filters.',
          values: { limit: AGG_LIMIT.toLocaleString() },
        })}
      </p>
    </EuiText>
  </EuiCallOut>
);

export const PassRateTip: React.FC = () => (
  <EuiIconTip
    type="questionInCircle"
    size="s"
    content={i18n.translate('agentTraces.evals.passRateTip', {
      defaultMessage:
        'Passed / (passed + failed) results. Scored-only results and evaluator errors are not counted.',
    })}
  />
);

/** A labelled value in a page's meta line. */
export const MetaItem: React.FC<{ label: string }> = ({ label, children }) => (
  <span className="agtEvlMeta__item">
    <span className="agtEvlDim">{label}</span> {children}
  </span>
);

export const RUN_A = i18n.translate('agentTraces.evals.runA', { defaultMessage: 'Run A' });
export const RUN_B = i18n.translate('agentTraces.evals.runB', { defaultMessage: 'Run B' });

/**
 * Results of a case as rows: evaluation, verdict, score bricks and explanation. The row wraps,
 * so the explanation gets the space left (or its own line in a narrow column).
 */
export const ResultRows: React.FC<{
  results: EvalResult[];
  onOpen: (r: EvalResult) => void;
  testId?: string;
}> = ({ results, onOpen, testId }) => (
  <div className="agtEvlResultRows" data-test-subj={testId}>
    {results.map((r) => (
      <div className="agtEvlResultRow" key={r.id}>
        <span className="agtEvlResultRow__name">
          <EuiLink onClick={() => onOpen(r)}>{r.name}</EuiLink>
        </span>
        <span className="agtEvlResultRow__verdict">
          <VerdictBadge verdict={r.verdict} />
        </span>
        <span className="agtEvlResultRow__score">
          <ScoreBricks r={r} />
        </span>
        <span className="agtEvlResultRow__why agtEvlDim">
          {r.explanation ?? r.errorType ?? DASH}
        </span>
      </div>
    ))}
  </div>
);

/**
 * A searchable list of runs (by run id, version or start time) to pick one from: Compare
 * with and the compare page's Change. `marked`: a run labelled "Run before".
 */
export const RunSelectList: React.FC<{
  runs: RunRow[];
  loading: boolean;
  onPick: (runId: string) => void;
  marked?: string;
  testId?: string;
}> = ({ runs, loading, onPick, marked, testId }) => {
  const options: Array<EuiSelectableOption<{ run: RunRow }>> = runs.map((r) => ({
    key: r.runId,
    label: `${r.runId} ${r.version ?? ''} ${formatTime(r.started)}`,
    run: r,
    'data-test-subj': `agtEvlRunOption-${r.runId}`,
  }));
  return (
    <div className="agtEvlRunSelect" data-test-subj={testId}>
      <EuiSelectable<{ run: RunRow }>
        searchable
        singleSelection
        isLoading={loading}
        options={options}
        searchProps={{
          compressed: true,
          placeholder: i18n.translate('agentTraces.evals.runSelect.search', {
            defaultMessage: 'Search run id, version or date',
          }),
          'data-test-subj': 'agtEvlRunSearch',
        }}
        listProps={{ bordered: false, rowHeight: 32 }}
        renderOption={(o) => (
          <span>
            {o.run.runId === marked && (
              <strong>
                {i18n.translate('agentTraces.evals.run.runBefore', {
                  defaultMessage: 'Run before',
                })}
                {' · '}
              </strong>
            )}
            <span className="agtEvlMono">{shortId(o.run.runId)}</span>{' '}
            <VersionBadge version={o.run.version} />{' '}
            <span className="agtEvlDim">{formatTime(o.run.started)}</span>
          </span>
        )}
        onChange={(next) => {
          const picked = next.find((o) => o.checked === 'on');
          if (picked?.key) onPick(String(picked.key));
        }}
      >
        {(list, search) => (
          <>
            <div className="agtEvlFacet__search">{search}</div>
            {list}
          </>
        )}
      </EuiSelectable>
    </div>
  );
};

const TARGET_LABEL: Record<ResultTarget['kind'], string> = {
  session: i18n.translate('agentTraces.evals.target.session', { defaultMessage: 'Session' }),
  trace: i18n.translate('agentTraces.evals.target.trace', { defaultMessage: 'Trace' }),
  span: i18n.translate('agentTraces.evals.target.span', { defaultMessage: 'Span' }),
};

/** One message per kind (a label inserted into a sentence does not translate). */
const TARGET_OPEN_TIP: Record<ResultTarget['kind'], string> = {
  session: i18n.translate('agentTraces.evals.target.openSessionTip', {
    defaultMessage: 'Open the session in Agent Traces in a new tab',
  }),
  trace: i18n.translate('agentTraces.evals.target.openTraceTip', {
    defaultMessage: 'Open the trace in Agent Traces in a new tab',
  }),
  span: i18n.translate('agentTraces.evals.target.openSpanTip', {
    defaultMessage: 'Open the span in Agent Traces in a new tab',
  }),
};

/**
 * What a result judged (session, trace or span, with its short id) and a link that opens it in
 * Agent Traces in a new tab. Clicks do not reach the row (which opens the result).
 */
export const TargetLink: React.FC<{ r: EvalResult; href?: string }> = ({ r, href }) => {
  const target = targetOf(r);
  if (!target) return <span className="agtEvlDim">{DASH}</span>;
  const id =
    target.kind === 'session' ? target.id : target.kind === 'span' ? target.spanId : target.traceId;
  const label = (
    <>
      <span className="agtEvlDim">{TARGET_LABEL[target.kind]}</span>{' '}
      <span className="agtEvlMono">{shortId(id)}</span>
    </>
  );
  if (!href) return <span data-test-subj={`agtEvlTarget-${target.kind}`}>{label}</span>;
  return (
    <EuiToolTip content={TARGET_OPEN_TIP[target.kind]}>
      <EuiLink
        href={href}
        target="_blank"
        external
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        data-test-subj={`agtEvlTarget-${target.kind}`}
      >
        {label}
      </EuiLink>
    </EuiToolTip>
  );
};

/** A labelled block of text (input, output, expected output). */
export const IOBlock: React.FC<{
  label: string;
  text?: string;
  note?: string;
  testId?: string;
}> = ({ label, text, note, testId }) => (
  <div className="agtEvlIO" data-test-subj={testId}>
    <EuiText size="xs" className="agtEvlIO__label">
      <span>
        {label}
        {note && <span className="agtEvlDim"> {note}</span>}
      </span>
    </EuiText>
    <EuiText size="xs">
      <p className="agtEvlProse agtEvlBox">
        {text ?? (
          <span className="agtEvlDim">
            {i18n.translate('agentTraces.evals.io.notRecorded', {
              defaultMessage: 'Not recorded',
            })}
          </span>
        )}
      </p>
    </EuiText>
  </div>
);

export const INPUT_LABEL = i18n.translate('agentTraces.evals.io.input', {
  defaultMessage: 'Input',
});
export const OUTPUT_LABEL = i18n.translate('agentTraces.evals.io.output', {
  defaultMessage: 'Output',
});
export const EXPECTED_LABEL = i18n.translate('agentTraces.evals.io.expected', {
  defaultMessage: 'Expected',
});
export const expectedNote = (truncated?: boolean) =>
  truncated
    ? i18n.translate('agentTraces.evals.io.expectedTruncated', {
        defaultMessage: 'opensearch.test.case.expected (truncated)',
      })
    : 'opensearch.test.case.expected';

/** The expected output of a case, from its result documents. */
export const expectedOf = (results: EvalResult[]) => {
  const withExpected = results.find((r) => r.expected !== undefined);
  return { text: withExpected?.expected, truncated: withExpected?.expectedTruncated };
};

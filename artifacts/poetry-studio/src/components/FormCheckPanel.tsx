import { AlertTriangle, Check, Info, RefreshCw } from 'lucide-react';
import type { FormCheckResult, FormCheckStatus } from '../lib/form-check';
import './FormCheckPanel.css';

type FormCheckPanelProps = {
  result: FormCheckResult;
  checking: boolean;
  onRecheck: () => void;
};

function StatusIcon({ status }: { status: FormCheckStatus }) {
  if (status === 'match') return <Check aria-hidden="true" />;
  if (status === 'warning') return <AlertTriangle aria-hidden="true" />;
  return <Info aria-hidden="true" />;
}

export default function FormCheckPanel({ result, checking, onRecheck }: FormCheckPanelProps) {
  const warnings = result.checks.filter((item) => item.status === 'warning').length;
  const measured = result.checks.some((item) => item.status !== 'info');
  const needsReview = result.checks.some((item) => item.status === 'info');
  const summary = warnings
    ? `${warnings} potential diversion${warnings === 1 ? '' : 's'}`
    : needsReview
      ? 'No flagged diversions; review the notes'
    : measured
      ? 'No measured diversions found'
      : 'Some form features need a manual check';

  return (
    <section className="form-check-panel" aria-label={`Form check for ${result.formName}`} data-testid="panel-form-check">
      <div className="form-check-head">
        <div>
          <div className="form-check-eyebrow">Form check</div>
          <h3>{result.formName}</h3>
          <p>{result.lineCount} lines · {result.stanzaCount} {result.stanzaCount === 1 ? 'stanza' : 'stanzas'}</p>
        </div>
        <button
          type="button"
          className="button small"
          onClick={onRecheck}
          disabled={checking}
          data-testid="button-recheck-form"
        ><RefreshCw aria-hidden="true" /> {checking ? 'Checking…' : 'Check again'}</button>
      </div>

      <div className={`form-check-summary${warnings ? ' has-warning' : measured ? ' is-match' : ''}`} role="status" data-testid="form-check-summary">
        {warnings ? <AlertTriangle aria-hidden="true" /> : measured ? <Check aria-hidden="true" /> : <Info aria-hidden="true" />}
        <strong>{summary}</strong>
      </div>

      <div className="form-check-list">
        {result.checks.map((item, index) => (
          <div className={`form-check-row status-${item.status}`} key={`${item.label}-${index}`}>
            <StatusIcon status={item.status} />
            <div><strong>{item.label}</strong><span>{item.detail}</span></div>
          </div>
        ))}
      </div>

      {result.lineSyllables.length > 0 && <div className="form-check-details">
        <h4>Syllables by line</h4>
        <div className="form-line-syllables">
          {result.lineSyllables.map((line) => {
            const differs = line.expected !== undefined && line.actual !== line.expected;
            return <div className={`form-line-count${differs ? ' is-warning' : ''}${line.estimatedWords.length ? ' is-estimated' : ''}`} key={line.line} data-testid={`form-line-check-${line.line}`}>
              <span>Line {line.line}</span>
              <strong title={line.estimatedWords.length ? `Estimated for: ${line.estimatedWords.join(', ')}` : undefined}>
                {line.estimatedWords.length ? '~' : ''}{line.actual}
                {line.expected !== undefined && <small> / {line.expected}</small>}
              </strong>
            </div>;
          })}
        </div>
      </div>}

      {result.rhymeChecks.length > 0 && <div className="form-check-details">
        <h4>Rhyme scheme by stanza</h4>
        <div className="form-rhyme-checks">
          {result.rhymeChecks.map((rhyme) => (
            <div className={`form-rhyme-row status-${rhyme.status}`} key={rhyme.stanza} data-testid={`form-rhyme-check-${rhyme.stanza}`}>
              <span>Stanza {rhyme.stanza}</span>
              <strong>{rhyme.actual}</strong>
              <small>expected {rhyme.expected}</small>
            </div>
          ))}
        </div>
      </div>}

      <div className="form-check-caveat">
        <strong>Use as a guide, not a verdict.</strong>
        <span>Poetry can intentionally depart from a form. Results reflect the latest check; run it again after editing.</span>
      </div>
      {result.notes.length > 0 && <details className="form-check-notes">
        <summary>What the checker may miss</summary>
        <ul>{result.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
      </details>}
    </section>
  );
}

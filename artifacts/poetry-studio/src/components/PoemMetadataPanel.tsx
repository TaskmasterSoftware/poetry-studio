import { useState, type KeyboardEvent } from 'react';
import { ExternalLink, Plus, Trash2, X } from 'lucide-react';
import type { PoemMetadata, PoemSubmission, PoemSubmissionStatus } from '../lib/poem-files';
import './PoemMetadataPanel.css';

type PoemMetadataPanelProps = {
  metadata: PoemMetadata;
  onChange: (metadata: PoemMetadata) => void;
};

function createId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `submission-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeWebsiteUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

export default function PoemMetadataPanel({ metadata, onChange }: PoemMetadataPanelProps) {
  const [tagInput, setTagInput] = useState('');
  const update = (changes: Partial<PoemMetadata>) => onChange({ ...metadata, ...changes });
  const updateSubmission = (id: string, changes: Partial<PoemSubmission>) => {
    update({
      submissions: metadata.submissions.map((submission) =>
        submission.id === id ? { ...submission, ...changes } : submission,
      ),
    });
  };
  const addTags = () => {
    const additions = tagInput.split(/[,;\n]+/).map((tag) => tag.trim()).filter(Boolean);
    if (!additions.length) return;
    const known = new Set(metadata.tags.map((tag) => tag.toLocaleLowerCase()));
    update({ tags: [...metadata.tags, ...additions.filter((tag) => !known.has(tag.toLocaleLowerCase()))] });
    setTagInput('');
  };
  const handleTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTags();
    }
  };
  const addSubmission = () => {
    const submission: PoemSubmission = {
      id: createId(),
      publisher: '',
      websiteUrl: '',
      submittedAt: '',
      status: 'pending',
      responseDate: '',
      notes: '',
    };
    update({ submissions: [...metadata.submissions, submission] });
  };
  const removeSubmission = (id: string) => {
    if (!window.confirm('Remove this submission record from the poem’s history? This cannot be undone.')) return;
    update({ submissions: metadata.submissions.filter((submission) => submission.id !== id) });
  };

  return (
    <section className="panel-card poem-metadata" aria-label="Poem metadata" data-testid="panel-poem-metadata">
      <div className="metadata-section-head">
        <div>
          <div className="field-label">Poem details</div>
          <p>Private notes saved with this poem.</p>
        </div>
      </div>

      <label className="metadata-field">
        <span className="field-label">Date written</span>
        <input
          className="text-field"
          type="date"
          value={metadata.dateWritten}
          onChange={(event) => update({ dateWritten: event.target.value })}
          data-testid="input-metadata-date-written"
        />
      </label>
      <label className="metadata-field">
        <span className="field-label">Poetic form</span>
        <input
          className="text-field"
          value={metadata.form}
          maxLength={120}
          placeholder="e.g. sonnet, ghazal, free verse"
          onChange={(event) => update({ form: event.target.value })}
          data-testid="input-metadata-form"
        />
      </label>
      <div className="metadata-field">
        <label className="field-label" htmlFor="poem-metadata-tags">Tags</label>
        <input
          id="poem-metadata-tags"
          className="text-field"
          value={tagInput}
          maxLength={500}
          placeholder="Type a tag, then press Enter"
          onChange={(event) => setTagInput(event.target.value)}
          onKeyDown={handleTagKeyDown}
          onBlur={addTags}
          data-testid="input-metadata-tag"
        />
        {metadata.tags.length > 0 && <div className="metadata-tags" aria-label="Saved tags">
          {metadata.tags.map((tag) => (
            <span className="metadata-tag" key={tag}>
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                title={`Remove tag ${tag}`}
                onClick={() => update({ tags: metadata.tags.filter((item) => item !== tag) })}
                data-testid={`button-remove-tag-${tag}`}
              ><X aria-hidden="true" /></button>
            </span>
          ))}
        </div>}
      </div>
      <label className="metadata-field">
        <span className="field-label">Notes</span>
        <textarea
          className="text-field metadata-textarea"
          rows={4}
          maxLength={20000}
          placeholder="Themes, context, or anything to remember…"
          value={metadata.notes}
          onChange={(event) => update({ notes: event.target.value })}
          data-testid="textarea-metadata-notes"
        />
      </label>

      <div className="metadata-submissions-head">
        <div>
          <div className="field-label">Submission history</div>
          <span>{metadata.submissions.length} {metadata.submissions.length === 1 ? 'record' : 'records'}</span>
        </div>
        <button className="button small" type="button" onClick={addSubmission} data-testid="button-add-submission">
          <Plus aria-hidden="true" /> Add
        </button>
      </div>
      {metadata.submissions.length === 0 ? (
        <div className="metadata-empty">No submissions recorded. Each publisher can have a separate entry.</div>
      ) : <div className="metadata-submissions">
        {metadata.submissions.map((submission, index) => {
          const website = safeWebsiteUrl(submission.websiteUrl);
          return (
            <article className="metadata-submission" key={submission.id} data-testid={`submission-record-${index + 1}`}>
              <div className="metadata-submission-title">
                <strong>{submission.publisher || `Submission ${index + 1}`}</strong>
                <button
                  className="metadata-remove"
                  type="button"
                  aria-label={`Remove submission ${index + 1}`}
                  title="Remove submission record"
                  onClick={() => removeSubmission(submission.id)}
                  data-testid={`button-remove-submission-${index + 1}`}
                ><Trash2 aria-hidden="true" /></button>
              </div>
              <label className="metadata-field">
                <span className="field-label">Publisher or journal</span>
                <input
                  className="text-field"
                  value={submission.publisher}
                  maxLength={200}
                  placeholder="Publisher name"
                  onChange={(event) => updateSubmission(submission.id, { publisher: event.target.value })}
                  data-testid={`input-submission-publisher-${index + 1}`}
                />
              </label>
              <label className="metadata-field">
                <span className="field-label">Website link</span>
                <input
                  className="text-field"
                  type="url"
                  value={submission.websiteUrl}
                  maxLength={1000}
                  placeholder="https://example.com"
                  onChange={(event) => updateSubmission(submission.id, { websiteUrl: event.target.value })}
                  data-testid={`input-submission-website-${index + 1}`}
                />
              </label>
              {website && <a className="metadata-website-link" href={website} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" /> Open publisher website
              </a>}
              <div className="metadata-date-status">
                <label className="metadata-field">
                  <span className="field-label">Submitted</span>
                  <input
                    className="text-field"
                    type="date"
                    value={submission.submittedAt}
                    onChange={(event) => updateSubmission(submission.id, { submittedAt: event.target.value })}
                    data-testid={`input-submission-date-${index + 1}`}
                  />
                </label>
                <label className="metadata-field">
                  <span className="field-label">Status</span>
                  <select
                    className="text-field"
                    value={submission.status}
                    onChange={(event) => updateSubmission(submission.id, { status: event.target.value as PoemSubmissionStatus })}
                    data-testid={`select-submission-status-${index + 1}`}
                  >
                    <option value="pending">Awaiting reply</option>
                    <option value="published">Published</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </label>
              </div>
              {submission.status !== 'pending' && <label className="metadata-field">
                <span className="field-label">Decision date</span>
                <input
                  className="text-field"
                  type="date"
                  value={submission.responseDate}
                  onChange={(event) => updateSubmission(submission.id, { responseDate: event.target.value })}
                  data-testid={`input-submission-decision-date-${index + 1}`}
                />
              </label>}
              <label className="metadata-field">
                <span className="field-label">Submission notes</span>
                <textarea
                  className="text-field metadata-textarea"
                  rows={2}
                  maxLength={10000}
                  value={submission.notes}
                  placeholder="Optional details"
                  onChange={(event) => updateSubmission(submission.id, { notes: event.target.value })}
                  data-testid={`textarea-submission-notes-${index + 1}`}
                />
              </label>
            </article>
          );
        })}
      </div>}
    </section>
  );
}

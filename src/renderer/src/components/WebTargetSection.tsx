import type { Translate } from './types'

interface WebTargetSectionProps {
  t: Translate
  url: string
  timeout: string
  urlError?: string | undefined
  timeoutError?: string | undefined
  actionState?: string | undefined
  onUrlChange(value: string): void
  onTimeoutChange(value: string): void
  onClearWebData(): void
}

export function WebTargetSection({
  t,
  url,
  timeout,
  urlError,
  timeoutError,
  actionState,
  onUrlChange,
  onTimeoutChange,
  onClearWebData,
}: WebTargetSectionProps) {
  return (
    <section className="settings-section" id="web" aria-labelledby="web-title">
      <h2 id="web-title">{t('web.title')}</h2>
      <div className="field-grid web-fields">
        <label className="field field-wide">
          <span>{t('web.url')}</span>
          <input
            aria-invalid={Boolean(urlError)}
            aria-describedby={urlError ? 'url-error' : undefined}
            type="url"
            value={url}
            onChange={(event) => onUrlChange(event.currentTarget.value)}
          />
          {urlError ? (
            <small className="field-error" id="url-error">
              {urlError}
            </small>
          ) : null}
        </label>
        <label className="field timeout-field">
          <span>{t('web.timeout')}</span>
          <span className="inline-control">
            <input
              aria-invalid={Boolean(timeoutError)}
              aria-label={t('web.timeout')}
              aria-describedby={timeoutError ? 'timeout-error' : undefined}
              inputMode="numeric"
              min="1"
              max="120"
              step="1"
              type="number"
              value={timeout}
              onChange={(event) => onTimeoutChange(event.currentTarget.value)}
            />
            <span>{t('web.seconds')}</span>
          </span>
          {timeoutError ? (
            <small className="field-error" id="timeout-error">
              {timeoutError}
            </small>
          ) : null}
        </label>
      </div>
      <div className="section-actions">
        <button
          className="button secondary"
          type="button"
          onClick={onClearWebData}
        >
          {t('web.clear')}
        </button>
        {actionState ? (
          <p className="inline-state" role="status">
            {actionState}
          </p>
        ) : null}
      </div>
    </section>
  )
}

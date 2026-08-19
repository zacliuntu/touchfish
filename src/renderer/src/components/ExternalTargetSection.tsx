import type { Translate } from './types'

interface ExternalTargetSectionProps {
  t: Translate
  executablePath: string
  argsText: string
  captureState?: string | undefined
  presetState?: string | undefined
  busy: boolean
  onPathChange(value: string): void
  onArgsChange(value: string): void
  onChoose(): void
  onCapture(): void
}

export function ExternalTargetSection({
  t,
  executablePath,
  argsText,
  captureState,
  presetState,
  busy,
  onPathChange,
  onArgsChange,
  onChoose,
  onCapture,
}: ExternalTargetSectionProps) {
  return (
    <section
      className="settings-section"
      id="external"
      aria-labelledby="external-title"
    >
      <h2 id="external-title">{t('external.title')}</h2>
      {presetState ? (
        <p className="inline-state preset-state" role="status">
          {presetState}
        </p>
      ) : null}
      <label className="field">
        <span>{t('external.path')}</span>
        <input
          type="text"
          value={executablePath}
          placeholder={t('external.pathPlaceholder')}
          onChange={(event) => onPathChange(event.currentTarget.value)}
        />
      </label>
      <label className="field">
        <span>{t('external.args')}</span>
        <textarea
          rows={2}
          value={argsText}
          onChange={(event) => onArgsChange(event.currentTarget.value)}
        />
        <small>{t('external.argsHint')}</small>
      </label>
      <div className="section-actions">
        <button
          className="button secondary"
          type="button"
          onClick={onChoose}
          disabled={busy}
        >
          {t('external.choose')}
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={onCapture}
          disabled={busy}
        >
          {t('external.capture')}
        </button>
        <small className="capture-hint">{t('external.captureHint')}</small>
      </div>
      {captureState ? (
        <p
          className="inline-state capture-state"
          role="status"
          aria-live="polite"
        >
          {captureState}
        </p>
      ) : null}
    </section>
  )
}

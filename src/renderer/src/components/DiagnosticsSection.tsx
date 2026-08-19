import type { DisplayInfo, NativeWindow } from '../../../shared/models'
import type { Translate } from './types'

interface DiagnosticsSectionProps {
  t: Translate
  displays: DisplayInfo[]
  windows: NativeWindow[]
  logs: Record<string, unknown>[]
  sceneState?: string | undefined
  sceneErrors: string[]
}

function readableLog(entry: Record<string, unknown>): string {
  return Object.entries(entry)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
    )
    .join(' · ')
}

export function DiagnosticsSection({
  t,
  displays,
  windows,
  logs,
  sceneState,
  sceneErrors,
}: DiagnosticsSectionProps) {
  return (
    <section
      className="settings-section diagnostics-section"
      id="diagnostics"
      aria-labelledby="diagnostics-title"
    >
      <h2 id="diagnostics-title">{t('diagnostics.title')}</h2>
      {sceneState ? (
        <div className="scene-result" role="status">
          <strong>{sceneState}</strong>
          {sceneErrors.length > 0 ? (
            <ul>
              {sceneErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="diagnostic-columns">
        <div>
          <h3>{t('diagnostics.displays')}</h3>
          {displays.length === 0 ? (
            <p className="empty-state">{t('diagnostics.empty')}</p>
          ) : (
            <ul className="plain-list">
              {displays.map((display) => (
                <li key={display.id}>
                  <strong>{display.label}</strong>
                  <span>
                    {display.bounds.width} × {display.bounds.height}
                    {display.primary ? ` · ${t('diagnostics.primary')}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>{t('diagnostics.windows')}</h3>
          {windows.length === 0 ? (
            <p className="empty-state">{t('diagnostics.empty')}</p>
          ) : (
            <ul className="plain-list">
              {windows.map((nativeWindow) => (
                <li key={nativeWindow.id}>
                  <strong>{nativeWindow.title}</strong>
                  <span>
                    {nativeWindow.visible
                      ? t('diagnostics.visible')
                      : t('diagnostics.hidden')}{' '}
                    · PID {nativeWindow.pid}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>{t('diagnostics.logs')}</h3>
          {logs.length === 0 ? (
            <p className="empty-state">{t('diagnostics.empty')}</p>
          ) : (
            <ol className="log-list">
              {logs.map((entry, index) => (
                <li key={index}>{readableLog(entry)}</li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  )
}

import type { DisplayInfo, TargetKind } from '../../../shared/models'
import type { Translate } from './types'

interface DisplayRulesSectionProps {
  t: Translate
  displays: DisplayInfo[]
  singleTarget: TargetKind
  swap: boolean
  webDisplayId: string | null
  externalDisplayId: string | null
  onSingleTargetChange(value: TargetKind): void
  onSwapChange(value: boolean): void
  onWebDisplayChange(value: string | null): void
  onExternalDisplayChange(value: string | null): void
}

function MonitorIcon({ index, active }: { index: number; active: boolean }) {
  return (
    <svg
      className={active ? 'monitor-icon active' : 'monitor-icon'}
      viewBox="0 0 68 48"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="62" height="34" rx="2" />
      <path d="M27 44h14M34 37v7" />
      <text x="34" y="27" textAnchor="middle">
        {index + 1}
      </text>
    </svg>
  )
}

export function DisplayRulesSection({
  t,
  displays,
  singleTarget,
  swap,
  webDisplayId,
  externalDisplayId,
  onSingleTargetChange,
  onSwapChange,
  onWebDisplayChange,
  onExternalDisplayChange,
}: DisplayRulesSectionProps) {
  const primary = displays.find((display) => display.primary) ?? displays[0]
  const secondary = displays.find((display) => display.id !== primary?.id)
  const webDisplay = swap ? secondary : primary
  const externalDisplay = swap ? primary : secondary

  return (
    <section
      className="settings-section"
      id="displays"
      aria-labelledby="displays-title"
    >
      <h2 id="displays-title">{t('displays.title')}</h2>
      <p className="section-caption">
        {displays.length === 0
          ? t('displays.noDisplays')
          : t('displays.detected', { count: displays.length })}
      </p>

      {displays.length === 1 ? (
        <label className="field compact-field">
          <span>{t('displays.singleTarget')}</span>
          <select
            value={singleTarget}
            onChange={(event) =>
              onSingleTargetChange(event.currentTarget.value as TargetKind)
            }
          >
            <option value="web">{t('displays.webTarget')}</option>
            <option value="external">{t('displays.externalTarget')}</option>
          </select>
        </label>
      ) : null}

      {displays.length === 2 && primary && secondary ? (
        <fieldset className="display-pair">
          <legend className="sr-only">{t('displays.title')}</legend>
          <div className="display-map-list">
            {displays.map((display, index) => (
              <div className="display-map-row" key={display.id}>
                <MonitorIcon index={index} active={display.primary} />
                <span className="display-name">
                  {display.label}
                  <small>
                    {display.bounds.width} × {display.bounds.height}
                  </small>
                </span>
              </div>
            ))}
          </div>
          <div className="assignment-list">
            <strong>
              {t('displays.webMapping', { display: webDisplay?.label ?? '' })}
            </strong>
            <strong>
              {t('displays.externalMapping', {
                display: externalDisplay?.label ?? '',
              })}
            </strong>
          </div>
          <label className="check-control">
            <input
              type="checkbox"
              checked={swap}
              onChange={(event) => onSwapChange(event.currentTarget.checked)}
            />
            <span>{t('displays.swap')}</span>
          </label>
        </fieldset>
      ) : null}

      {displays.length >= 3 ? (
        <div className="field-grid display-selectors">
          <label className="field">
            <span>{t('displays.webDisplay')}</span>
            <select
              value={webDisplayId ?? ''}
              onChange={(event) =>
                onWebDisplayChange(event.currentTarget.value || null)
              }
            >
              <option value="">{t('displays.chooseDisplay')}</option>
              {displays.map((display) => (
                <option value={display.id} key={display.id}>
                  {display.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('displays.externalDisplay')}</span>
            <select
              value={externalDisplayId ?? ''}
              onChange={(event) =>
                onExternalDisplayChange(event.currentTarget.value || null)
              }
            >
              <option value="">{t('displays.chooseDisplay')}</option>
              {displays.map((display) => (
                <option value={display.id} key={display.id}>
                  {display.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </section>
  )
}

import type { AppLanguage } from '../../../shared/models'
import type { Translate } from './types'

interface GeneralSectionProps {
  t: Translate
  language: AppLanguage
  startAtLogin: boolean
  onLanguageChange(value: AppLanguage): void
  onStartAtLoginChange(value: boolean): void
}

export function GeneralSection({
  t,
  language,
  startAtLogin,
  onLanguageChange,
  onStartAtLoginChange,
}: GeneralSectionProps) {
  return (
    <section
      className="settings-section"
      id="general"
      aria-labelledby="general-title"
    >
      <h2 id="general-title">{t('general.title')}</h2>
      <div className="general-row">
        <label className="field compact-field">
          <span>{t('general.language')}</span>
          <select
            value={language}
            onChange={(event) =>
              onLanguageChange(event.currentTarget.value as AppLanguage)
            }
          >
            <option value="system">{t('general.system')}</option>
            <option value="zh-CN">{t('general.chinese')}</option>
            <option value="en">{t('general.english')}</option>
          </select>
        </label>
        <label className="switch-control">
          <input
            type="checkbox"
            checked={startAtLogin}
            onChange={(event) =>
              onStartAtLoginChange(event.currentTarget.checked)
            }
          />
          <span className="switch-track" aria-hidden="true">
            <span />
          </span>
          <span>{t('general.startAtLogin')}</span>
        </label>
      </div>
    </section>
  )
}

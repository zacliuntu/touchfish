import type { Translate } from './types'

interface LegacyProposal {
  url: string
}

interface FirstRunWizardProps {
  t: Translate
  showWelcome: boolean
  legacyProposal: LegacyProposal | null
  confirmingLegacy: boolean
  migrationBusy: boolean
  migrationState?: string | undefined
  onReviewLegacy(): void
  onCancelLegacy(): void
  onConfirmLegacy(): void
}

export function FirstRunWizard({
  t,
  showWelcome,
  legacyProposal,
  confirmingLegacy,
  migrationBusy,
  migrationState,
  onReviewLegacy,
  onCancelLegacy,
  onConfirmLegacy,
}: FirstRunWizardProps) {
  if (!showWelcome && !legacyProposal && !migrationState) return null

  return (
    <div className="guidance-panel" role="status">
      {showWelcome ? (
        <div className="guidance-copy">
          <span className="info-mark" aria-hidden="true">
            i
          </span>
          <div>
            <strong>{t('firstRun.title')}</strong>
            <p>{t('firstRun.body')}</p>
          </div>
        </div>
      ) : null}
      {legacyProposal ? (
        <div className="legacy-proposal">
          <div>
            <strong>{t('firstRun.legacyTitle')}</strong>
            <p>{t('firstRun.legacyBody')}</p>
            <code>{legacyProposal.url}</code>
          </div>
          {!confirmingLegacy ? (
            <button
              className="button secondary"
              type="button"
              onClick={onReviewLegacy}
            >
              {t('firstRun.review')}
            </button>
          ) : (
            <div
              className="legacy-confirm"
              role="group"
              aria-label={t('firstRun.confirmTitle')}
            >
              <p>
                <strong>{t('firstRun.confirmTitle')}</strong>
              </p>
              <p>{t('firstRun.confirmBody')}</p>
              <div className="section-actions">
                <button
                  className="button ghost"
                  type="button"
                  onClick={onCancelLegacy}
                  disabled={migrationBusy}
                >
                  {t('firstRun.cancel')}
                </button>
                <button
                  className="button danger"
                  type="button"
                  onClick={onConfirmLegacy}
                  disabled={migrationBusy}
                >
                  {migrationBusy
                    ? t('firstRun.importing')
                    : t('firstRun.confirm')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
      {migrationState ? <p className="inline-state">{migrationState}</p> : null}
    </div>
  )
}

import React from 'react'
import Icon from './Icon'
import { Form, SLOTS, dayLabel } from './data'
import { useT } from './i18n'

export type Generation = {
  busy: boolean
  elapsed: number
  stage: string
  error: string | null
  result: { url: string; filename: string; size: number } | null
  onGenerate: () => void
  onCancel: () => void
}

/** The full-page summary: everything the presentation will contain, with one click back to the assistant or the form. */
export default function Recap({ form, nights, datesText, hasLogo, generation, onAssistant, onEdit }: {
  form: Form
  nights: number
  datesText: string
  hasLogo: boolean
  generation: Generation
  onAssistant: () => void
  onEdit: (step: number) => void
}) {
  const t = useT()
  const locale = t('fr-FR', 'en-GB')
  const filledDays = form.days.filter(d => d.slots.some(Boolean) || d.notes.length).length
  const ready = form.client.trim().length > 0 && form.hotels.length > 0 && filledDays > 0

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-8 rise">
      <div className="card overflow-hidden">
        <header className="flex flex-wrap items-start justify-between gap-5 p-7 sm:p-10 text-white"
          style={{ background: 'linear-gradient(160deg, var(--burgundy) 0%, var(--burgundy-deep) 100%)' }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">{t('Récapitulatif', 'Summary')}</p>
            <h1 className="font-display mt-1 text-4xl font-semibold sm:text-5xl">{form.client || t('Client à renseigner', 'Client to fill in')}</h1>
            {form.eventTitle && <p className="mt-1 text-lg text-white/80">{form.eventTitle}</p>}
            {datesText && (
              <p className="mt-3 inline-flex items-center gap-2 text-white/85">
                <Icon name="calendar" className="w-4 h-4" /> {datesText}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn !bg-white !text-[var(--burgundy)] hover:!bg-[var(--sand)]" onClick={onAssistant}>
              <Icon name="chat" className="w-4 h-4" /> {t('Modifier avec l’assistant', 'Edit with the assistant')}
            </button>
            <button type="button" className="btn border-white/40 text-white hover:bg-white/10" onClick={() => onEdit(0)}>
              <Icon name="note" className="w-4 h-4" /> {t('Modifier à la main', 'Edit by hand')}
            </button>
          </div>
        </header>

        <div className="space-y-9 p-7 sm:p-10">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[[form.numDays, t('jours', 'days')], [nights, nights > 1 ? t('nuits', 'nights') : t('nuit', 'night')], [form.numPeople, t('personnes', 'people')]].map(([n, l]) => (
              <div key={l as string} className="inner px-4 py-4 text-center">
                <div className="font-display text-3xl font-semibold text-[var(--burgundy)]">{n}</div>
                <div className="text-sm text-[var(--muted)]">{l}</div>
              </div>
            ))}
            <div className="inner flex flex-col items-center justify-center px-4 py-4 text-center">
              <Icon name={hasLogo ? 'check' : 'upload'} className={`w-6 h-6 ${hasLogo ? 'text-[var(--ok)]' : 'text-[var(--taupe)]'}`} />
              <div className="mt-1 text-sm text-[var(--muted)]">{hasLogo ? t('Logo ajouté', 'Logo added') : t('Pas de logo', 'No logo')}</div>
            </div>
          </div>

          <section aria-labelledby="recap-hotels">
            <SectionTitle id="recap-hotels" title={t('Hébergement', 'Accommodation')} onEdit={() => onEdit(1)} />
            {form.hotels.length === 0 ? (
              <p className="inner p-4 text-[var(--muted)]">{t('Aucun hôtel choisi.', 'No hotel chosen.')}</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {form.hotels.map((h, i) => (
                  <li key={i} className="inner flex items-center gap-4 p-4">
                    <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-white text-[var(--burgundy)]">
                      <Icon name="bed" className="w-5 h-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold leading-tight">{h.hotelName}</p>
                      <p className="text-sm text-[var(--muted)]">{h.rooms} {h.rooms > 1 ? t('chambres', 'rooms') : t('chambre', 'room')}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="recap-program">
            <SectionTitle id="recap-program" title={t('Programme', 'Programme')} onEdit={() => onEdit(2)} />
            <div className="grid gap-4 lg:grid-cols-2">
              {form.days.map((d, i) => (
                <article key={i} className="rounded-[14px] border border-[var(--line)] bg-white p-5">
                  <h3 className="font-display text-lg font-semibold">
                    {t('Jour', 'Day')} {i + 1}
                    <span className="ml-2 text-sm font-normal text-[var(--muted)]">{d.dateOverride ?? dayLabel(form.startDate, i, locale)}</span>
                  </h3>
                  <ul className="mt-3 space-y-2">
                    {SLOTS.map((slot, k) => (
                      <li key={slot.key} className="flex items-center gap-3">
                        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[var(--sand)] text-[var(--burgundy)]">
                          <Icon name={slot.icon} className="w-4 h-4" />
                        </span>
                        <span className="w-28 flex-none text-sm text-[var(--muted)]">{t(slot.label, slot.en)}</span>
                        <span className={d.slots[k] ? 'font-medium' : 'text-[var(--taupe)]'}>{d.slots[k] || '—'}</span>
                      </li>
                    ))}
                  </ul>
                  {d.notes.length > 0 && (
                    <p className="mt-3 flex items-start gap-2 text-sm text-[var(--muted)]">
                      <Icon name="note" className="mt-0.5 w-4 h-4 flex-none" /> {d.notes.length} {d.notes.length > 1 ? t('notes manuelles', 'manual notes') : t('note manuelle', 'manual note')}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>

          <GenerationPanel generation={generation} ready={ready} />
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ id, title, onEdit }: { id: string; title: string; onEdit: () => void }) {
  const t = useT()
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 id={id} className="label !mb-0">{title}</h2>
      <button type="button" className="btn btn-quiet" onClick={onEdit}>{t('Modifier', 'Edit')}</button>
    </div>
  )
}

function GenerationPanel({ generation: g, ready }: { generation: Generation; ready: boolean }) {
  const t = useT()
  return (
    <section aria-label={t('Génération', 'Generation')} className="border-t border-[var(--line)] pt-8">
      {g.busy && (
        <div className="inner p-5 rise" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold">{g.stage}</p>
              <p className="text-sm text-[var(--muted)]">{t('Cela peut prendre jusqu’à 2 minutes', 'This can take up to 2 minutes')} · {g.elapsed} s</p>
            </div>
            <button type="button" className="btn btn-ghost" onClick={g.onCancel}>{t('Annuler', 'Cancel')}</button>
          </div>
          <div className="indeterminate relative mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--sand)]" />
        </div>
      )}

      {g.error && !g.busy && (
        <div role="alert" className="mb-4 flex gap-3 rounded-[12px] border border-[#e8c3be] bg-[#fbeceb] p-4 text-[var(--danger)] rise">
          <Icon name="alert" className="w-5 h-5 mt-0.5 flex-none" />
          <div><p className="font-semibold">{t('La génération a échoué', 'The generation failed')}</p><p className="text-sm mt-0.5">{g.error}</p></div>
        </div>
      )}

      {g.result && !g.busy && (
        <div className="mb-4 rounded-[12px] border border-[#bfd8c9] bg-[#edf6f0] p-5 rise" role="status">
          <div className="flex items-start gap-3 text-[var(--ok)]">
            <Icon name="check" className="w-5 h-5 mt-0.5 flex-none" strokeWidth={2.5} />
            <div>
              <p className="font-semibold">{t('Présentation prête', 'Presentation ready')}</p>
              <p className="text-sm">{g.result.filename} · {(g.result.size / 1048576).toFixed(1)} {t('Mo', 'MB')} — {t('le téléchargement a démarré.', 'the download has started.')}</p>
            </div>
          </div>
          <a href={g.result.url} download={g.result.filename} className="btn btn-ghost mt-4 bg-white">
            <Icon name="download" className="w-4 h-4" /> {t('Télécharger à nouveau', 'Download again')}
          </a>
        </div>
      )}

      {!g.busy && (
        <>
          <button type="button" onClick={g.onGenerate} disabled={!ready} className="btn btn-primary w-full !min-h-[56px] text-base">
            <Icon name="file" className="w-5 h-5" />
            {g.result ? t('Générer à nouveau', 'Generate again') : t('Générer la présentation', 'Generate the presentation')}
          </button>
          {!ready && <p className="mt-2 text-center text-sm text-[var(--muted)]">{t('Il manque le client, un hôtel ou au moins une case du programme.', 'The client, a hotel or at least one programme cell is missing.')}</p>}
        </>
      )}
    </section>
  )
}

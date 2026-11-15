import React, { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import AgentScreen, { ChatMessage } from './Agent'
import Recap from './Recap'
import Admin from './Admin'
import { LangButton, LangContext, Lang, readLang, saveLang, tNow, useT } from './i18n'
import {
  DayPlan, Form, GROUPS, GROUP_EN, fitsSlot, isDeparture, HOTEL_OPTIONS, HotelEntry, SLOTS, applyPatch, dayLabel, datesLabel, emptyDay, initialForm,
} from './data'

const API_URL = (import.meta as any).env?.VITE_API_URL || 'https://ppt-generator-api-8v70.onrender.com'
const DRAFT_KEY = 'pref-ppt-draft-v1'
// The password is checked by the server (APP_PASSWORD); the tab only remembers what was typed.
const AUTH_KEY = 'pref-ppt-pw'
const getPassword = () => { try { return sessionStorage.getItem(AUTH_KEY) || '' } catch { return '' } }

const STEPS = [
  { label: 'Événement', hint: 'Client et dates', en: ['Event', 'Client and dates'] },
  { label: 'Hébergement', hint: 'Hôtels et chambres', en: ['Accommodation', 'Hotels and rooms'] },
  { label: 'Programme', hint: 'Jour par jour', en: ['Programme', 'Day by day'] },
  { label: 'Génération', hint: 'Vérifier et télécharger', en: ['Generate', 'Check and download'] },
]

const STAGES = [
  ['Préparation du modèle…', 'Preparing the template…'],
  ['Assemblage des hôtels…', 'Assembling the hotels…'],
  ['Construction du programme…', 'Building the programme…'],
  ['Finalisation du fichier…', 'Finalising the file…'],
]

function loadDraft(): Form {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (raw) {
      const parsed = { ...initialForm(), ...JSON.parse(raw) }
      if (Array.isArray(parsed.days) && Array.isArray(parsed.hotels)) return parsed
    }
  } catch {
    /* ignore a broken draft */
  }
  return initialForm()
}

/** Convert any image to PNG: the backend only reads JPEG/PNG (not WEBP/SVG). */
async function toPng(file: File): Promise<File> {
  if (file.type === 'image/png' || file.type === 'image/jpeg') return file
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error(tNow('Format d’image non supporté. Utilisez un PNG ou un JPEG.', 'Unsupported image format. Use a PNG or a JPEG.')))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || 800
    canvas.height = img.naturalHeight || 400
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error(tNow('Conversion impossible', 'Conversion failed')))), 'image/png'))
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function apiMessage(text: string, status: number): string {
  try {
    const detail = JSON.parse(text).detail
    if (typeof detail === 'string') return detail.replace(/^ERROR:\s*/, '')
    if (Array.isArray(detail)) return detail.map((d: any) => d.msg).join(' · ')
  } catch {
    /* not JSON */
  }
  if (status === 0 || status >= 502) return tNow('Le serveur ne répond pas. Il démarre peut-être : réessayez dans une minute.', 'The server is not answering. It may be starting up: try again in a minute.')
  return text || `Erreur ${status}`
}

/* ───────────────────────── small pieces ───────────────────────── */

function Field({ label, htmlFor, hint, children }: {
  label: string; htmlFor: string; hint?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  )
}

function Counter({ id, value, min, max, onChange, label }: {
  id: string; value: number; min: number; max?: number; onChange: (n: number) => void; label: string
}) {
  const t = useT()
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min, n))
  return (
    <div className="flex items-center gap-2">
      <button type="button" className="btn btn-ghost !px-0 w-12" aria-label={`${t('Moins de', 'Fewer')} ${label}`}
        onClick={() => onChange(clamp(value - 1))} disabled={value <= min}>
        <Icon name="minus" className="w-4 h-4" />
      </button>
      <input id={id} type="number" inputMode="numeric" className="field text-center" value={value} min={min} max={max}
        onChange={e => onChange(clamp(Number(e.target.value) || min))} />
      <button type="button" className="btn btn-ghost !px-0 w-12" aria-label={`${t('Plus de', 'More')} ${label}`}
        onClick={() => onChange(clamp(value + 1))} disabled={max !== undefined && value >= max}>
        <Icon name="plus" className="w-4 h-4" />
      </button>
    </div>
  )
}

function Stepper({ current, maxReached, goTo }: { current: number; maxReached: number; goTo: (n: number) => void }) {
  const t = useT()
  return (
    <nav aria-label={t('Étapes', 'Steps')}>
      <ol className="flex lg:flex-col gap-2 lg:gap-1">
        {STEPS.map((step, i) => {
          const state = i === current ? 'current' : i < current || i <= maxReached ? 'done' : 'todo'
          const reachable = i <= maxReached
          return (
            <li key={step.label} className="flex-1 lg:flex-none">
              <button type="button" disabled={!reachable} onClick={() => goTo(i)}
                aria-current={i === current ? 'step' : undefined}
                className="group w-full flex items-center gap-3 rounded-[12px] px-2 py-2 text-left transition-colors enabled:hover:bg-[var(--sand)] disabled:cursor-default">
                <span className="step-dot" data-state={state}>
                  {state === 'done' && i !== current ? <Icon name="check" className="w-4 h-4" strokeWidth={2.5} /> : i + 1}
                </span>
                <span className="hidden sm:block min-w-0">
                  <span className={`block text-sm font-semibold ${i === current ? 'text-[var(--burgundy)]' : reachable ? 'text-[var(--ink)]' : 'text-[var(--muted)]'}`}>
                    {t(step.label, step.en[0])}
                  </span>
                  <span className="hidden lg:block text-xs text-[var(--muted)]">{t(step.hint, step.en[1])}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/* ───────────────────────── login ───────────────────────── */

function Login({ onSuccess }: { onSuccess: () => void }) {
  const t = useT()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setChecking(true)
    try {
      const res = await fetch(`${API_URL}/login`, { method: 'POST', headers: { 'X-App-Password': password } })
      if (res.ok) {
        sessionStorage.setItem(AUTH_KEY, password)
        onSuccess()
        return
      }
      let detail = t('Mot de passe incorrect', 'Wrong password')
      try { detail = (await res.json()).detail || detail } catch { /* not JSON */ }
      setError(detail)
      setPassword('')
    } catch {
      setError(t('Le serveur ne répond pas (il se réveille peut-être, réessaie dans une minute).', 'The server is not answering (it may be waking up, try again in a minute).'))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <aside className="hidden lg:flex flex-col justify-between p-14 text-white"
        style={{ background: 'linear-gradient(160deg, var(--burgundy) 0%, var(--burgundy-deep) 100%)' }}>
        <div className="self-start rounded-[18px] bg-white p-1.5 shadow-lg">
          <img src="/logo_1.png" alt="Preference Events" className="h-20 w-auto rounded-[12px]" />
        </div>
        <div>
          <h1 className="font-display text-5xl font-bold leading-[1.05]">
            {t('Des présentations', 'Marrakech')}<br />{t('Marrakech, prêtes', 'presentations, ready')}<br />{t('en quelques minutes.', 'in minutes.')}
          </h1>
          <p className="mt-6 max-w-md text-white/70 leading-relaxed">
            {t('Choisissez les hôtels, composez le programme jour par jour : le PowerPoint est assemblé avec la nouvelle charte.', 'Pick the hotels, build the programme day by day: the PowerPoint is assembled with the new brand template.')}
          </p>
        </div>
        <p className="text-xs text-white/50">© {new Date().getFullYear()} Preference Events — Marrakech</p>
      </aside>

      <main className="relative flex items-center justify-center p-6">
        <LangButton className="absolute right-4 top-4" />
        <form onSubmit={submit} className="w-full max-w-sm rise">
          <span className="mb-8 inline-block self-start rounded-[14px] bg-white p-1.5 shadow-sm lg:hidden"><img src="/logo_1.png" alt="Preference Events" className="h-14 w-auto" /></span>
          <h2 className="font-display text-3xl font-semibold">{t('Connexion', 'Sign in')}</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">{t('Accès réservé à l’équipe Preference Events.', 'Access reserved for the Preference Events team.')}</p>
          <div className="mt-8">
            <label className="label" htmlFor="password">{t('Mot de passe', 'Password')}</label>
            <input id="password" type="password" autoFocus autoComplete="current-password" className="field"
              value={password} onChange={e => { setPassword(e.target.value); setError('') }}
              aria-invalid={!!error} aria-describedby={error ? 'password-error' : undefined} />
            {error && <p id="password-error" role="alert" className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
          </div>
          <button type="submit" className="btn btn-primary w-full mt-6" disabled={!password || checking}>
            {checking ? t('Connexion…', 'Signing in…') : <>{t('Accéder', 'Enter')} <Icon name="right" className="w-4 h-4" /></>}
          </button>
        </form>
      </main>
    </div>
  )
}

/* ───────────────────────── steps ───────────────────────── */

type Setter = (patch: Partial<Form>) => void

function StepEvent({ form, set, nights, datesText, logoFile, logoPreview, onLogo, onLogoClear, logoError }: {
  form: Form; set: Setter; nights: number; datesText: string
  logoFile: File | null; logoPreview: string | null
  onLogo: (f: File | null) => void; onLogoClear: () => void; logoError: string
}) {
  const t = useT()
  const [dragging, setDragging] = useState(false)
  return (
    <div className="grid sm:grid-cols-2 gap-x-5 gap-y-6">
      <Field label={t('Nom du client', 'Client name')} htmlFor="client">
        <input id="client" className="field" value={form.client} autoFocus placeholder={t('Ex : Société Dupont', 'E.g. Acme Corp')}
          onChange={e => set({ client: e.target.value })} />
      </Field>
      <Field label={t('Titre de l’événement', 'Event title')} htmlFor="title">
        <input id="title" className="field" value={form.eventTitle} placeholder={t('Ex : Séminaire annuel 2026', 'E.g. Annual seminar 2026')}
          onChange={e => set({ eventTitle: e.target.value })} />
      </Field>

      <Field label={t('Date d’arrivée', 'Arrival date')} htmlFor="start" hint={datesText ? `${t('Affiché', 'Shown')} : ${datesText}` : t('Remplit automatiquement les dates de chaque jour.', 'Fills in each day’s date automatically.')}>
        <input id="start" type="date" className="field" value={form.startDate}
          onChange={e => set({ startDate: e.target.value, datesOverride: null })} />
      </Field>
      <Field label={t('Dates affichées', 'Dates shown')} htmlFor="dates" hint={t('Modifiable, par exemple « du 25 au 28 octobre ». Ce texte apparaît tel quel dans la présentation (en français).', 'Editable, e.g. “du 25 au 28 octobre”. This text appears as is in the presentation (in French).')}>
        <input id="dates" className="field" value={datesText} placeholder={t('Ex : 25 au 28 octobre 2026', 'E.g. 25 au 28 octobre 2026')}
          onChange={e => set({ datesOverride: e.target.value })} />
      </Field>

      <Field label={t('Nombre de jours', 'Number of days')} htmlFor="days">
        <Counter id="days" value={form.numDays} min={1} max={8} label={t('jours', 'days')} onChange={n => set({ numDays: n })} />
      </Field>
      <Field label={t('Nombre de nuits', 'Number of nights')} htmlFor="nights">
        <Counter id="nights" value={nights} min={0} max={9} label={t('nuits', 'nights')} onChange={n => set({ numNights: n })} />
      </Field>

      <Field label={t('Nombre de personnes', 'Number of people')} htmlFor="people">
        <Counter id="people" value={form.numPeople} min={1} label={t('personnes', 'people')} onChange={n => set({ numPeople: n })} />
      </Field>

      <Field label={t('Villes de départ des vols', 'Departure cities')} htmlFor="cities" hint={t('Facultatif. Plusieurs villes (jusqu’à 5, séparées par des virgules) ajoutent les plans de vol aller et retour.', 'Optional. Several cities (up to 5, comma-separated) add the outbound and return flight plans.')}>
        <input id="cities" className="field" value={form.departureCities} placeholder={t('Ex : Paris, Lyon, Nantes', 'E.g. Paris, Lyon, Nantes')}
          onChange={e => set({ departureCities: e.target.value })} />
      </Field>

      <div>
        <span className="label">{t('Logo du client', 'Client logo')} <span className="normal-case tracking-normal font-normal">({t('facultatif', 'optional')})</span></span>
        {logoPreview ? (
          <div className="inner flex items-center gap-3 p-2.5">
            <div className="h-14 w-20 flex-none rounded-[8px] bg-white border border-[var(--line)] flex items-center justify-center p-1">
              <img src={logoPreview} alt={t('Aperçu du logo', 'Logo preview')} className="max-h-full max-w-full object-contain" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{logoFile?.name}</p>
              <p className="text-xs text-[var(--muted)]">{logoFile ? Math.max(1, Math.round(logoFile.size / 1024)) : 0} {t('Ko', 'KB')}</p>
            </div>
            <button type="button" className="icon-btn" onClick={onLogoClear} aria-label={t('Retirer le logo', 'Remove the logo')}>
              <Icon name="x" className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <label
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); onLogo(e.dataTransfer.files?.[0] || null) }}
            className={`flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-[12px] border-2 border-dashed px-4 py-3 text-sm transition-colors ${dragging ? 'border-[var(--burgundy)] bg-[var(--sand)]' : 'border-[var(--taupe)] hover:bg-[var(--sand)]'}`}>
            <Icon name="upload" className="w-4 h-4 text-[var(--muted)]" />
            <span>{t('Glisser une image ou', 'Drop an image or')} <span className="font-semibold text-[var(--burgundy)]">{t('parcourir', 'browse')}</span></span>
            <input type="file" accept="image/*" className="sr-only" onChange={e => onLogo(e.target.files?.[0] || null)} />
          </label>
        )}
        {logoError && <p role="alert" className="mt-1.5 text-xs text-[var(--danger)]">{logoError}</p>}
        <p className="mt-1.5 text-xs text-[var(--muted)]">{t('Affiché sur la page de garde.', 'Shown on the cover page.')}</p>
      </div>
    </div>
  )
}

function StepHotels({ form, set }: { form: Form; set: Setter }) {
  const t = useT()
  const update = (i: number, patch: Partial<HotelEntry>) =>
    set({ hotels: form.hotels.map((h, k) => (k === i ? { ...h, ...patch } : h)) })
  return (
    <div>
      {form.hotels.length === 0 && (
        <p className="inner p-5 text-[var(--muted)]">{t('Aucun hôtel pour l’instant. Ajoute-en un pour continuer.', 'No hotel yet. Add one to continue.')}</p>
      )}
      <ul className="space-y-3">
        {form.hotels.map((h, i) => (
          <li key={i} className="inner rise p-3 grid gap-3 sm:grid-cols-[1fr_180px_auto] items-end">
            <Field label={form.hotels.length > 1 ? `${t('Hôtel', 'Hotel')} ${i + 1}` : t('Hôtel', 'Hotel')} htmlFor={`hotel-${i}`}>
              <select id={`hotel-${i}`} className="select" value={h.hotelName}
                onChange={e => update(i, { hotelName: e.target.value })}>
                {HOTEL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label={t('Chambres', 'Rooms')} htmlFor={`rooms-${i}`}>
              <Counter id={`rooms-${i}`} value={h.rooms} min={1} label={t('chambres', 'rooms')} onChange={n => update(i, { rooms: n })} />
            </Field>
            <button type="button" className="icon-btn mb-1" aria-label={`${t('Retirer l’hôtel', 'Remove hotel')} ${i + 1}`}
              onClick={() => set({ hotels: form.hotels.filter((_, k) => k !== i) })}>
              <Icon name="trash" className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-quiet mt-4"
        onClick={() => set({ hotels: [...form.hotels, { hotelName: HOTEL_OPTIONS[0], rooms: 10 }] })}>
        <Icon name="plus" className="w-4 h-4" /> {t('Ajouter un hôtel', 'Add a hotel')}
      </button>
      {form.hotels.length > 1 && (
        <p className="mt-3 text-sm text-[var(--muted)]">{t('Une slide « Propositions d’hébergement » sera ajoutée avant les hôtels.', 'An “accommodation proposals” slide will be added before the hotels.')}</p>
      )}
    </div>
  )
}

function StepProgram({ form, set, day, setDay }: {
  form: Form; set: Setter; day: number; setDay: (n: number) => void
}) {
  const t = useT()
  const plan = form.days[day]
  const [noteDraft, setNoteDraft] = useState('')
  const update = (patch: Partial<DayPlan>) =>
    set({ days: form.days.map((d, i) => (i === day ? { ...d, ...patch } : d)) })
  const filled = (d: DayPlan) => d.slots.filter(Boolean).length

  return (
    <div>
      <div role="tablist" aria-label={t('Jours', 'Days')} className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
        {form.days.map((d, i) => (
          <button key={i} role="tab" type="button" aria-selected={i === day} className="day-tab" onClick={() => setDay(i)}>
            <span className="block text-sm font-semibold">{t('Jour', 'Day')} {i + 1}</span>
            <span className={`block text-xs ${i === day ? 'text-white/75' : 'text-[var(--muted)]'}`}>
              {filled(d) ? `${filled(d)} / 5` : t('vide', 'empty')}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5 grid sm:grid-cols-[1fr_auto] gap-4 items-end">
        <Field label={t('Date affichée', 'Date shown')} htmlFor="day-date">
          <input id="day-date" className="field" placeholder={t('Ex : Lundi 25 octobre', 'E.g. Lundi 25 octobre')}
            value={plan.dateOverride ?? dayLabel(form.startDate, day)}
            onChange={e => update({ dateOverride: e.target.value })} />
        </Field>
        {filled(plan) > 0 && (
          <button type="button" className="btn btn-quiet" onClick={() => update({ slots: ['', '', '', '', ''] })}>
            <Icon name="refresh" className="w-4 h-4" /> {t('Vider le jour', 'Clear the day')}
          </button>
        )}
      </div>

      <ul className="mt-5 space-y-2.5">
        {SLOTS.map((slot, k) => (
          <li key={slot.key} className="slot-row" data-filled={!!plan.slots[k]}>
            <label htmlFor={`slot-${k}`} className="flex items-center gap-2.5 text-sm font-semibold">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--sand)] text-[var(--burgundy)]">
                <Icon name={slot.icon} className="w-4 h-4" />
              </span>
              {t(slot.label, slot.en)}
            </label>
            <select id={`slot-${k}`} className="select" value={plan.slots[k]} disabled={plan.slots.slice(0, k).some(isDeparture)}
              onChange={e => {
                const value = e.target.value
                // after a departure the day is over: the following cells are emptied
                update({ slots: plan.slots.map((s, i) => (i === k ? value : isDeparture(value) && i > k ? '' : s)) })
              }}>
              <option value="">— {t('Aucun', 'None')} —</option>
              {plan.slots[k] && !slot.groups.some(g => GROUPS[g].filter(o => fitsSlot(slot.key, o)).includes(plan.slots[k])) && (
                <option value={plan.slots[k]}>{plan.slots[k]}</option>
              )}
              {slot.groups.map(g => (
                <optgroup key={g} label={t(g, GROUP_EN[g])}>
                  {GROUPS[g].filter(o => fitsSlot(slot.key, o)).map(o => <option key={g + o} value={o}>{o}</option>)}
                </optgroup>
              ))}
            </select>
            <button type="button" className="icon-btn" aria-label={`${t('Vider', 'Clear')} ${t(slot.label, slot.en)}`} disabled={!plan.slots[k]}
              onClick={() => update({ slots: plan.slots.map((s, i) => (i === k ? '' : s)) })}>
              <Icon name="x" className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-7">
        <h3 className="label">{t('Notes manuelles', 'Manual notes')}</h3>
        <p className="text-sm text-[var(--muted)] mb-3">{t('Chaque note ajoute une slide vide avec votre texte, à compléter dans PowerPoint.', 'Each note adds an empty slide with your text, to complete in PowerPoint.')}</p>
        {plan.notes.length > 0 && (
          <ul className="space-y-2 mb-3">
            {plan.notes.map((n, i) => (
              <li key={i} className="inner flex items-start gap-3 p-3">
                <Icon name="note" className="w-4 h-4 mt-0.5 text-[var(--burgundy)] flex-none" />
                <p className="flex-1 text-sm">{n}</p>
                <button type="button" className="icon-btn !h-7 !w-7" aria-label={t('Supprimer la note', 'Delete the note')}
                  onClick={() => update({ notes: plan.notes.filter((_, k) => k !== i) })}>
                  <Icon name="x" className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input className="field" value={noteDraft} placeholder={t('Ex : Ajouter les photos du restaurant', 'E.g. Add the restaurant photos')}
            aria-label={t('Nouvelle note', 'New note')}
            onChange={e => setNoteDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && noteDraft.trim()) {
                e.preventDefault(); update({ notes: [...plan.notes, noteDraft.trim()] }); setNoteDraft('')
              }
            }} />
          <button type="button" className="btn btn-ghost" disabled={!noteDraft.trim()}
            onClick={() => { update({ notes: [...plan.notes, noteDraft.trim()] }); setNoteDraft('') }}>
            {t('Ajouter', 'Add')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── summary ───────────────────────── */

/** Live checklist of the presentation. `known` = the fields already given (null = everything counts, as in the form). */
function Summary({ form, nights, datesText, hasLogo, known, onLogo }: {
  form: Form; nights: number; datesText: string; hasLogo: boolean; known: Set<string> | null; onLogo?: () => void
}) {
  const t = useT()
  const has = (key: string) => known === null || known.has(key)
  const dayFilled = form.days.map(d => d.slots.filter(Boolean).length)
  const programKnown = has('days') && dayFilled.some(n => n > 0)
  const items = [
    { key: 'client', icon: 'user', label: t('Client', 'Client'), done: !!form.client.trim() },
    { key: 'dates', icon: 'calendar', label: t('Dates', 'Dates'), done: has('startDate') && !!datesText },
    { key: 'people', icon: 'user', label: t('Participants', 'Participants'), done: has('numPeople') },
    { key: 'hotels', icon: 'bed', label: t('Hébergement', 'Accommodation'), done: form.hotels.length > 0 },
    { key: 'program', icon: 'compass', label: t('Programme', 'Programme'), done: programKnown && dayFilled.every(n => n > 0) },
  ]
  const doneCount = items.filter(i => i.done).length
  const Pending = ({ children = t('à renseigner', 'to fill in') }: { children?: React.ReactNode }) =>
    <span className="text-[var(--taupe)]">{children}</span>

  return (
    <aside className="card p-5 lg:sticky lg:top-28" aria-label={t('Récapitulatif', 'Summary')}>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="label !mb-0">{t('Votre présentation', 'Your presentation')}</h2>
        <span className="text-xs font-semibold text-[var(--burgundy)]">{doneCount} / {items.length}</span>
      </div>
      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-[var(--sand)]" role="progressbar"
        aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={doneCount} aria-label={t('Avancement', 'Progress')}>
        <div className="h-full rounded-full bg-[var(--burgundy)] transition-all duration-500" style={{ width: `${(doneCount / items.length) * 100}%` }} />
      </div>

      <ul className="space-y-4 text-sm">
        <li>
          <p className="text-xs text-[var(--muted)]">{t('Client', 'Client')}</p>
          <p className="font-display text-lg font-semibold leading-tight">{form.client || <Pending />}</p>
          {form.eventTitle && <p className="text-[var(--muted)]">{form.eventTitle}</p>}
        </li>
        <li>
          <p className="text-xs text-[var(--muted)]">Dates</p>
          <p>{has('startDate') && datesText ? datesText : <Pending />}</p>
        </li>
        <li className="grid grid-cols-3 gap-2 text-center">
          {[[has('numDays') ? form.numDays : '—', t('jours', 'days')], [has('numDays') || has('numNights') ? nights : '—', nights > 1 ? t('nuits', 'nights') : t('nuit', 'night')],
            [has('numPeople') ? form.numPeople : '—', t('pers.', 'ppl')]].map(([n, l]) => (
            <div key={l as string} className="inner py-2">
              <div className={`font-display text-lg font-semibold ${n === '—' ? 'text-[var(--taupe)]' : ''}`}>{n}</div>
              <div className="text-[11px] text-[var(--muted)]">{l}</div>
            </div>
          ))}
        </li>
        <li>
          <p className="mb-1 text-xs text-[var(--muted)]">{t('Hôtels', 'Hotels')}</p>
          {form.hotels.length === 0 && <Pending />}
          {form.hotels.map((h, i) => (
            <p key={i} className="flex justify-between gap-2 py-0.5">
              <span className="truncate">{h.hotelName}</span><span className="flex-none text-[var(--muted)]">{h.rooms} {t('ch.', 'rooms')}</span>
            </p>
          ))}
        </li>
        <li>
          <p className="mb-1 text-xs text-[var(--muted)]">{t('Programme', 'Programme')}</p>
          {!programKnown ? <Pending /> : form.days.map((d, i) => {
            const n = dayFilled[i]
            return (
              <p key={i} className="flex items-center justify-between py-0.5">
                <span>{t('Jour', 'Day')} {i + 1}</span>
                <span className={n === 5 ? 'font-medium text-[var(--ok)]' : n ? 'font-medium text-[var(--ok)]' : 'text-[var(--taupe)]'}>
                  {n ? `${n} / 5` : t('à remplir', 'to fill')}
                </span>
              </p>
            )
          })}
        </li>
        <li className="flex items-center justify-between border-t border-[var(--line)] pt-3">
          <span className="text-xs text-[var(--muted)]">{t('Logo du client', 'Client logo')}</span>
          {hasLogo ? (
            <span className="flex items-center gap-1 font-medium text-[var(--ok)]"><Icon name="check" className="w-4 h-4" strokeWidth={2.5} /> {t('ajouté', 'added')}</span>
          ) : onLogo ? (
            <button type="button" className="btn btn-quiet !min-h-0 !py-1" onClick={onLogo}>
              <Icon name="upload" className="w-4 h-4" /> {t('Ajouter', 'Add')}
            </button>
          ) : <Pending>{t('facultatif', 'optional')}</Pending>}
        </li>
      </ul>
    </aside>
  )
}

/* ───────────────────────── app ───────────────────────── */

export default function App() {
  const [lang, setLangState] = useState<Lang>(readLang)
  const setLang = (l: Lang) => { saveLang(l); setLangState(l); document.documentElement.lang = l }
  useEffect(() => { document.documentElement.lang = lang }, [])
  return <LangContext.Provider value={{ lang, setLang }}><AppInner /></LangContext.Provider>
}

function AppInner() {
  const t = useT()
  const locale = t('fr-FR', 'en-GB')
  const [authed, setAuthed] = useState(() => !!getPassword())
  const [form, setForm] = useState<Form>(loadDraft)
  // A fresh visit starts with the assistant; a saved draft resumes in the form
  const [mode, setMode] = useState<'agent' | 'form' | 'recap' | 'admin'>(() => (loadDraft().client.trim() ? 'form' : 'agent'))
  const [chat, setChat] = useState<ChatMessage[]>([])
  // what the assistant has actually been told so far (the summary shows the rest as « à renseigner »)
  const [known, setKnown] = useState<Set<string>>(() => (loadDraft().client.trim() ? new Set(['client', 'eventTitle', 'startDate', 'numDays', 'numNights', 'numPeople', 'hotels', 'days']) : new Set()))
  const logoInput = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState(0)
  const [maxReached, setMaxReached] = useState(0)
  const [day, setDay] = useState(0)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoError, setLogoError] = useState('')

  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ url: string; filename: string; size: number } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const set: Setter = patch => { setForm(f => ({ ...f, ...patch })); setKnown(k => new Set([...k, ...Object.keys(patch)])) } // a manual edit counts as given
  const nights = form.numNights ?? Math.max(form.numDays - 1, 0)
  const datesText = form.datesOverride ?? datesLabel(form.startDate, form.numDays) // French: goes into the presentation
  const datesShown = form.datesOverride ?? datesLabel(form.startDate, form.numDays, locale)

  // Keep one plan per day
  useEffect(() => {
    setForm(f => f.days.length === f.numDays ? f : {
      ...f, days: Array.from({ length: f.numDays }, (_, i) => f.days[i] || emptyDay()),
    })
    setDay(d => Math.min(d, form.numDays - 1))
  }, [form.numDays])

  // Draft autosave (the logo file cannot be stored)
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)) } catch { /* private mode */ }
  }, [form])

  useEffect(() => {
    if (!busy) return
    setElapsed(0)
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [busy])

  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])

  const filledDays = form.days.filter(d => d.slots.some(Boolean) || d.notes.length).length
  const stepValid = [
    form.client.trim().length > 0,
    form.hotels.length > 0,
    filledDays > 0,
    true,
  ]
  const blocker = [
    t('Indiquez le nom du client pour continuer.', 'Enter the client name to continue.'),
    '',
    t('Remplissez au moins une case dans le programme.', 'Fill in at least one cell of the programme.'),
    '',
  ]

  function goTo(n: number) {
    setMaxReached(m => Math.max(m, n))
    // the last step is the full-page recap
    if (n >= STEPS.length - 1) setMode('recap')
    else { setStep(n); setMode('form') }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function onLogo(file: File | null) {
    setLogoError('')
    if (!file) return
    try {
      const png = await toPng(file)
      setLogoFile(png)
      setLogoPreview(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(png) })
    } catch (e: any) {
      setLogoError(e?.message || t('Image illisible', 'Unreadable image'))
    }
  }

  function clearLogo() {
    setLogoFile(null)
    setLogoPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null })
  }

  function reset() {
    if (result) URL.revokeObjectURL(result.url)
    setResult(null); setError(null); setForm(initialForm()); clearLogo(); setStep(0); setMaxReached(0); setDay(0)
    setChat([]); setKnown(new Set()); setMode('agent')
  }

  async function generate() {
    setError(null)
    if (result) { URL.revokeObjectURL(result.url); setResult(null) }
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const fd = new FormData()
      fd.append('client', form.client.trim())
      fd.append('eventTitle', form.eventTitle.trim())
      fd.append('dates', datesText || 'à définir')
      fd.append('startDate', form.startDate)
      fd.append('numDays', String(form.numDays))
      fd.append('numNights', String(nights))
      fd.append('numPeople', String(form.numPeople))
      fd.append('departureCities', form.departureCities)
      fd.append('hotels', JSON.stringify(form.hotels))
      fd.append('dayPlans', JSON.stringify(form.days.map((d, i) => ({
        date: d.dateOverride ?? dayLabel(form.startDate, i),
        slots: d.slots,
        steps: d.slots.filter(Boolean),
        manualNotes: d.notes,
      }))))
      if (logoFile) fd.append('logo', logoFile)

      const res = await fetch(`${API_URL}/generate`, { method: 'POST', body: fd, headers: { 'X-App-Password': getPassword() }, signal: controller.signal })
      if (res.status === 401) { sessionStorage.removeItem(AUTH_KEY); setAuthed(false); return }
      if (!res.ok) throw new Error(apiMessage(await res.text(), res.status))
      const blob = await res.blob()
      const filename = `presentation_marrakech_${(form.client || 'client').trim().replace(/[^a-zA-Z0-9_-]+/g, '_')}.pptx`
      const url = URL.createObjectURL(blob)
      setResult({ url, filename, size: blob.size })
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); a.remove()
    } catch (e: any) {
      if (e?.name === 'AbortError') setError(t('Génération annulée.', 'Generation cancelled.'))
      else setError(e?.message === 'Failed to fetch' ? apiMessage('', 0) : e?.message || t('Erreur inconnue', 'Unknown error'))
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const stage = t(...(STAGES[Math.min(STAGES.length - 1, Math.floor(elapsed / 15))] as [string, string]))

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />

  const summary = (
    <Summary form={form} nights={nights} datesText={datesShown} hasLogo={!!logoFile}
      known={mode === 'agent' ? known : null} onLogo={() => logoInput.current?.click()} />
  )

  return (
    <div className="min-h-screen">
      <input ref={logoInput} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label={t('Logo du client', 'Client logo')}
        onChange={e => { onLogo(e.target.files?.[0] || null); e.target.value = '' }} />
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--cream)]">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="rounded-[12px] bg-white p-1 shadow-sm"><img src="/logo_1.png" alt="Preference Events" className="h-12 w-auto" /></span>
            <span className="hidden sm:block h-5 w-px bg-[var(--line)]" />
            <span className="hidden sm:block text-base text-[var(--muted)]">{t('Générateur de présentations', 'Presentation generator')}</span>
          </div>
          <div className="flex items-center gap-1">
            <LangButton />
            <button type="button" className="btn btn-quiet !text-[var(--muted)]" onClick={() => setMode(mode === 'admin' ? 'agent' : 'admin')} aria-label="Admin" title="Admin">
              <Icon name="chart" className="w-4 h-4" />
            </button>
            {mode !== 'agent' && (
              <button type="button" className="btn btn-quiet" onClick={() => setMode('agent')}>
                <Icon name="chat" className="w-4 h-4" /><span className="hidden sm:inline">{t('Assistant', 'Assistant')}</span>
              </button>
            )}
            {mode === 'agent' && form.client.trim() && (
              <button type="button" className="btn btn-quiet" onClick={() => setMode('recap')}>
                <Icon name="file" className="w-4 h-4" /><span className="hidden sm:inline">{t('Récapitulatif', 'Summary')}</span>
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => { if (confirm(t('Effacer le formulaire et recommencer ?', 'Clear the form and start over?'))) reset() }}>
              <Icon name="refresh" className="w-4 h-4" /><span className="hidden sm:inline">{t('Nouveau', 'New')}</span>
            </button>
            <button type="button" className="btn btn-quiet !text-[var(--muted)]"
              onClick={() => { sessionStorage.removeItem(AUTH_KEY); setAuthed(false) }}>
              <Icon name="logout" className="w-4 h-4" /><span className="hidden sm:inline">{t('Déconnexion', 'Sign out')}</span>
            </button>
          </div>
        </div>
      </header>

      {mode === 'admin' ? (
        <Admin apiUrl={API_URL} onBack={() => setMode('agent')} />
      ) : mode === 'agent' ? (
        <AgentScreen
          form={form}
          known={known}
          messages={chat}
          setMessages={setChat}
          onPatch={patch => { setForm(f => applyPatch(f, patch)); setKnown(k => new Set([...k, ...Object.keys(patch).filter(key => patch[key] != null && !(Array.isArray(patch[key]) && patch[key].length === 0))])) }}
          logoFile={logoFile}
          onLogo={onLogo}
          onLogoClear={clearLogo}
          apiUrl={API_URL}
          password={getPassword()}
          onManual={() => setMode('form')}
          onReview={() => { setMaxReached(3); setMode('recap'); window.scrollTo({ top: 0 }) }}
          onReset={() => { if (confirm(t('Effacer la conversation et le formulaire, et recommencer ?', 'Clear the conversation and the form, and start over?'))) reset() }}
          summary={summary}
        />
      ) : mode === 'recap' ? (
        <Recap
          form={form}
          nights={nights}
          datesText={datesShown}
          hasLogo={!!logoFile}
          generation={{ busy, elapsed, stage, error, result, onGenerate: generate, onCancel: () => abortRef.current?.abort() }}
          onAssistant={() => setMode('agent')}
          onEdit={n => { setStep(n); setMode('form'); window.scrollTo({ top: 0 }) }}
        />
      ) : (
      <div className="mx-auto grid max-w-[1400px] gap-6 px-5 py-8 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[12rem_minmax(0,1fr)_19rem]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Stepper current={step} maxReached={maxReached} goTo={goTo} />
          <button type="button" className="btn btn-quiet mt-4 !text-[var(--muted)]"
            onClick={() => { if (confirm(t('Effacer le formulaire et recommencer ?', 'Clear the form and start over?'))) reset() }}>
            <Icon name="refresh" className="w-4 h-4" /> {t('Recommencer', 'Start over')}
          </button>
        </div>

        <main>
          <section className="card p-6 sm:p-10 rise" key={step} aria-labelledby="step-title">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--burgundy)]">{t('Étape', 'Step')} {step + 1} {t('sur', 'of')} {STEPS.length}</p>
            <h1 id="step-title" className="font-display mt-1 text-4xl font-semibold">
              {[t('Informations sur l’événement', 'Event details'), t('Hébergement', 'Accommodation'), t('Programme', 'Programme'), t('Votre présentation', 'Your presentation')][step]}
            </h1>
            <p className="mt-1.5 mb-7 text-[var(--muted)]">
              {[
                t('Ces informations apparaissent sur la page de garde et dans l’introduction.', 'This appears on the cover page and in the introduction.'),
                t('Un ou plusieurs hôtels, avec le nombre de chambres réservées.', 'One or more hotels, with the number of rooms booked.'),
                t('Remplissez les cases de chaque journée. Les photos sont ajoutées automatiquement.', 'Fill in the cells of each day. Photos are added automatically.'),
                t('Vérifiez le récapitulatif puis lancez la génération.', 'Check the summary, then start the generation.'),
              ][step]}
            </p>

            {step === 0 && (
              <StepEvent form={form} set={set} nights={nights} datesText={datesText} logoFile={logoFile}
                logoPreview={logoPreview} onLogo={onLogo} onLogoClear={clearLogo} logoError={logoError} />
            )}
            {step === 1 && <StepHotels form={form} set={set} />}
            {step === 2 && <StepProgram form={form} set={set} day={day} setDay={setDay} />}

          </section>

          <div className="mt-5 flex items-center justify-between gap-3">
            <button type="button" className="btn btn-ghost" onClick={() => goTo(step - 1)} disabled={step === 0 || busy}>
              <Icon name="left" className="w-4 h-4" /> {t('Retour', 'Back')}
            </button>
            {step < STEPS.length - 1 && (
              <div className="flex items-center gap-3">
                {!stepValid[step] && <span className="hidden sm:block text-sm text-[var(--muted)]">{blocker[step]}</span>}
                <button type="button" className="btn btn-primary" onClick={() => goTo(step + 1)} disabled={!stepValid[step]}>
                  {step === STEPS.length - 2 ? t('Voir le récapitulatif', 'See the summary') : t('Continuer', 'Continue')} <Icon name="right" className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </main>

        <div className="hidden xl:block">{summary}</div>
      </div>
      )}
    </div>
  )
}

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import AgentScreen, { ChatMessage } from './Agent'
import {
  DayPlan, Form, GROUPS, HOTEL_OPTIONS, HotelEntry, SLOTS, applyPatch, dayLabel, datesLabel, emptyDay, initialForm,
} from './data'

const API_URL = (import.meta as any).env?.VITE_API_URL || 'https://ppt-generator-api-8v70.onrender.com'
const DRAFT_KEY = 'pref-ppt-draft-v1'
// The password is checked by the server (APP_PASSWORD); the tab only remembers what was typed.
const AUTH_KEY = 'pref-ppt-pw'
const getPassword = () => { try { return sessionStorage.getItem(AUTH_KEY) || '' } catch { return '' } }

const STEPS = [
  { label: 'Événement', hint: 'Client et dates' },
  { label: 'Hébergement', hint: 'Hôtels et chambres' },
  { label: 'Programme', hint: 'Jour par jour' },
  { label: 'Génération', hint: 'Vérifier et télécharger' },
]

const STAGES = [
  'Préparation du modèle…',
  'Assemblage des hôtels…',
  'Construction du programme…',
  'Finalisation du fichier…',
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
      el.onerror = () => reject(new Error('Format d’image non supporté. Utilisez un PNG ou un JPEG.'))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || 800
    canvas.height = img.naturalHeight || 400
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Conversion impossible'))), 'image/png'))
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
  if (status === 0 || status >= 502) return 'Le serveur ne répond pas. Il démarre peut-être : réessayez dans une minute.'
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
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min, n))
  return (
    <div className="flex items-center gap-2">
      <button type="button" className="btn btn-ghost !px-0 w-12" aria-label={`Moins de ${label}`}
        onClick={() => onChange(clamp(value - 1))} disabled={value <= min}>
        <Icon name="minus" className="w-4 h-4" />
      </button>
      <input id={id} type="number" inputMode="numeric" className="field text-center" value={value} min={min} max={max}
        onChange={e => onChange(clamp(Number(e.target.value) || min))} />
      <button type="button" className="btn btn-ghost !px-0 w-12" aria-label={`Plus de ${label}`}
        onClick={() => onChange(clamp(value + 1))} disabled={max !== undefined && value >= max}>
        <Icon name="plus" className="w-4 h-4" />
      </button>
    </div>
  )
}

function Stepper({ current, maxReached, goTo }: { current: number; maxReached: number; goTo: (n: number) => void }) {
  return (
    <nav aria-label="Étapes">
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
                    {step.label}
                  </span>
                  <span className="hidden lg:block text-xs text-[var(--muted)]">{step.hint}</span>
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
      let detail = 'Mot de passe incorrect'
      try { detail = (await res.json()).detail || detail } catch { /* not JSON */ }
      setError(detail)
      setPassword('')
    } catch {
      setError('Le serveur ne répond pas (il se réveille peut-être, réessaie dans une minute).')
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
            Des présentations<br />Marrakech, prêtes<br />en quelques minutes.
          </h1>
          <p className="mt-6 max-w-md text-white/70 leading-relaxed">
            Choisissez les hôtels, composez le programme jour par jour : le PowerPoint est assemblé avec la nouvelle charte.
          </p>
        </div>
        <p className="text-xs text-white/50">© {new Date().getFullYear()} Preference Events — Marrakech</p>
      </aside>

      <main className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm rise">
          <img src="/logo_1.png" alt="Preference Events" className="h-16 w-auto mb-8 lg:hidden mix-blend-multiply -ml-3" />
          <h2 className="font-display text-3xl font-semibold">Connexion</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">Accès réservé à l’équipe Preference Events.</p>
          <div className="mt-8">
            <label className="label" htmlFor="password">Mot de passe</label>
            <input id="password" type="password" autoFocus autoComplete="current-password" className="field"
              value={password} onChange={e => { setPassword(e.target.value); setError('') }}
              aria-invalid={!!error} aria-describedby={error ? 'password-error' : undefined} />
            {error && <p id="password-error" role="alert" className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
          </div>
          <button type="submit" className="btn btn-primary w-full mt-6" disabled={!password || checking}>
            {checking ? 'Connexion…' : <>Accéder <Icon name="right" className="w-4 h-4" /></>}
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
  const [dragging, setDragging] = useState(false)
  return (
    <div className="grid sm:grid-cols-2 gap-x-5 gap-y-6">
      <Field label="Nom du client" htmlFor="client">
        <input id="client" className="field" value={form.client} autoFocus placeholder="Ex : Société Dupont"
          onChange={e => set({ client: e.target.value })} />
      </Field>
      <Field label="Titre de l’événement" htmlFor="title">
        <input id="title" className="field" value={form.eventTitle} placeholder="Ex : Séminaire annuel 2026"
          onChange={e => set({ eventTitle: e.target.value })} />
      </Field>

      <Field label="Date d’arrivée" htmlFor="start" hint={datesText ? `Affiché : ${datesText}` : 'Remplit automatiquement les dates de chaque jour.'}>
        <input id="start" type="date" className="field" value={form.startDate}
          onChange={e => set({ startDate: e.target.value, datesOverride: null })} />
      </Field>
      <Field label="Dates affichées" htmlFor="dates" hint="Modifiable, par exemple « du 25 au 28 octobre ».">
        <input id="dates" className="field" value={datesText} placeholder="Ex : 25 au 28 octobre 2026"
          onChange={e => set({ datesOverride: e.target.value })} />
      </Field>

      <Field label="Nombre de jours" htmlFor="days">
        <Counter id="days" value={form.numDays} min={1} max={8} label="jours" onChange={n => set({ numDays: n })} />
      </Field>
      <Field label="Nombre de nuits" htmlFor="nights">
        <Counter id="nights" value={nights} min={0} max={9} label="nuits" onChange={n => set({ numNights: n })} />
      </Field>

      <Field label="Nombre de personnes" htmlFor="people">
        <Counter id="people" value={form.numPeople} min={1} label="personnes" onChange={n => set({ numPeople: n })} />
      </Field>

      <div>
        <span className="label">Logo du client <span className="normal-case tracking-normal font-normal">(facultatif)</span></span>
        {logoPreview ? (
          <div className="inner flex items-center gap-3 p-2.5">
            <div className="h-14 w-20 flex-none rounded-[8px] bg-white border border-[var(--line)] flex items-center justify-center p-1">
              <img src={logoPreview} alt="Aperçu du logo" className="max-h-full max-w-full object-contain" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{logoFile?.name}</p>
              <p className="text-xs text-[var(--muted)]">{logoFile ? Math.max(1, Math.round(logoFile.size / 1024)) : 0} Ko</p>
            </div>
            <button type="button" className="icon-btn" onClick={onLogoClear} aria-label="Retirer le logo">
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
            <span>Glisser une image ou <span className="font-semibold text-[var(--burgundy)]">parcourir</span></span>
            <input type="file" accept="image/*" className="sr-only" onChange={e => onLogo(e.target.files?.[0] || null)} />
          </label>
        )}
        {logoError && <p role="alert" className="mt-1.5 text-xs text-[var(--danger)]">{logoError}</p>}
        <p className="mt-1.5 text-xs text-[var(--muted)]">Affiché sur la page de garde.</p>
      </div>
    </div>
  )
}

function StepHotels({ form, set }: { form: Form; set: Setter }) {
  const update = (i: number, patch: Partial<HotelEntry>) =>
    set({ hotels: form.hotels.map((h, k) => (k === i ? { ...h, ...patch } : h)) })
  return (
    <div>
      {form.hotels.length === 0 && (
        <p className="inner p-5 text-[var(--muted)]">Aucun hôtel pour l’instant. Ajoute-en un pour continuer.</p>
      )}
      <ul className="space-y-3">
        {form.hotels.map((h, i) => (
          <li key={i} className="inner rise p-3 grid gap-3 sm:grid-cols-[1fr_180px_auto] items-end">
            <Field label={form.hotels.length > 1 ? `Hôtel ${i + 1}` : 'Hôtel'} htmlFor={`hotel-${i}`}>
              <select id={`hotel-${i}`} className="select" value={h.hotelName}
                onChange={e => update(i, { hotelName: e.target.value })}>
                {HOTEL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Chambres" htmlFor={`rooms-${i}`}>
              <Counter id={`rooms-${i}`} value={h.rooms} min={1} label="chambres" onChange={n => update(i, { rooms: n })} />
            </Field>
            <button type="button" className="icon-btn mb-1" aria-label={`Retirer l’hôtel ${i + 1}`}
              onClick={() => set({ hotels: form.hotels.filter((_, k) => k !== i) })}>
              <Icon name="trash" className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-quiet mt-4"
        onClick={() => set({ hotels: [...form.hotels, { hotelName: HOTEL_OPTIONS[0], rooms: 10 }] })}>
        <Icon name="plus" className="w-4 h-4" /> Ajouter un hôtel
      </button>
      {form.hotels.length > 1 && (
        <p className="mt-3 text-sm text-[var(--muted)]">Une slide « Propositions d’hébergement » sera ajoutée avant les hôtels.</p>
      )}
    </div>
  )
}

function StepProgram({ form, set, day, setDay }: {
  form: Form; set: Setter; day: number; setDay: (n: number) => void
}) {
  const plan = form.days[day]
  const [noteDraft, setNoteDraft] = useState('')
  const update = (patch: Partial<DayPlan>) =>
    set({ days: form.days.map((d, i) => (i === day ? { ...d, ...patch } : d)) })
  const filled = (d: DayPlan) => d.slots.filter(Boolean).length

  return (
    <div>
      <div role="tablist" aria-label="Jours" className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
        {form.days.map((d, i) => (
          <button key={i} role="tab" type="button" aria-selected={i === day} className="day-tab" onClick={() => setDay(i)}>
            <span className="block text-sm font-semibold">Jour {i + 1}</span>
            <span className={`block text-xs ${i === day ? 'text-white/75' : 'text-[var(--muted)]'}`}>
              {filled(d) ? `${filled(d)} / 5` : 'vide'}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5 grid sm:grid-cols-[1fr_auto] gap-4 items-end">
        <Field label="Date affichée" htmlFor="day-date">
          <input id="day-date" className="field" placeholder="Ex : Lundi 25 octobre"
            value={plan.dateOverride ?? dayLabel(form.startDate, day)}
            onChange={e => update({ dateOverride: e.target.value })} />
        </Field>
        {filled(plan) > 0 && (
          <button type="button" className="btn btn-quiet" onClick={() => update({ slots: ['', '', '', '', ''] })}>
            <Icon name="refresh" className="w-4 h-4" /> Vider le jour
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
              {slot.label}
            </label>
            <select id={`slot-${k}`} className="select" value={plan.slots[k]}
              onChange={e => update({ slots: plan.slots.map((s, i) => (i === k ? e.target.value : s)) })}>
              <option value="">— Aucun —</option>
              {plan.slots[k] && !slot.groups.some(g => GROUPS[g].includes(plan.slots[k])) && (
                <option value={plan.slots[k]}>{plan.slots[k]}</option>
              )}
              {slot.groups.map(g => (
                <optgroup key={g} label={g}>
                  {GROUPS[g].map(o => <option key={g + o} value={o}>{o}</option>)}
                </optgroup>
              ))}
            </select>
            <button type="button" className="icon-btn" aria-label={`Vider ${slot.label}`} disabled={!plan.slots[k]}
              onClick={() => update({ slots: plan.slots.map((s, i) => (i === k ? '' : s)) })}>
              <Icon name="x" className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-7">
        <h3 className="label">Notes manuelles</h3>
        <p className="text-sm text-[var(--muted)] mb-3">Chaque note ajoute une slide vide avec votre texte, à compléter dans PowerPoint.</p>
        {plan.notes.length > 0 && (
          <ul className="space-y-2 mb-3">
            {plan.notes.map((n, i) => (
              <li key={i} className="inner flex items-start gap-3 p-3">
                <Icon name="note" className="w-4 h-4 mt-0.5 text-[var(--burgundy)] flex-none" />
                <p className="flex-1 text-sm">{n}</p>
                <button type="button" className="icon-btn !h-7 !w-7" aria-label="Supprimer la note"
                  onClick={() => update({ notes: plan.notes.filter((_, k) => k !== i) })}>
                  <Icon name="x" className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input className="field" value={noteDraft} placeholder="Ex : Ajouter les photos du restaurant"
            aria-label="Nouvelle note"
            onChange={e => setNoteDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && noteDraft.trim()) {
                e.preventDefault(); update({ notes: [...plan.notes, noteDraft.trim()] }); setNoteDraft('')
              }
            }} />
          <button type="button" className="btn btn-ghost" disabled={!noteDraft.trim()}
            onClick={() => { update({ notes: [...plan.notes, noteDraft.trim()] }); setNoteDraft('') }}>
            Ajouter
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── summary ───────────────────────── */

function Summary({ form, nights, datesText, hasLogo }: { form: Form; nights: number; datesText: string; hasLogo: boolean }) {
  return (
    <aside className="card p-5 lg:sticky lg:top-28" aria-label="Récapitulatif">
      <h2 className="label !mb-4">Votre présentation</h2>
      <dl className="space-y-4 text-sm">
        <div>
          <dt className="text-xs text-[var(--muted)]">Client</dt>
          <dd className="font-display text-lg font-semibold leading-tight">{form.client || '—'}</dd>
          {form.eventTitle && <dd className="text-[var(--muted)]">{form.eventTitle}</dd>}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[[form.numDays, 'jours'], [nights, 'nuits'], [form.numPeople, 'pers.']].map(([n, l]) => (
            <div key={l as string} className="inner py-2">
              <div className="font-display text-lg font-semibold">{n}</div>
              <div className="text-[11px] text-[var(--muted)]">{l}</div>
            </div>
          ))}
        </div>
        {datesText && <p className="text-[var(--muted)]">{datesText}</p>}
        <div>
          <dt className="text-xs text-[var(--muted)] mb-1">Hôtels</dt>
          {form.hotels.length === 0 && <dd className="text-[var(--muted)]">—</dd>}
          {form.hotels.map((h, i) => (
            <dd key={i} className="flex justify-between gap-2 py-0.5">
              <span className="truncate">{h.hotelName}</span><span className="text-[var(--muted)] flex-none">{h.rooms} ch.</span>
            </dd>
          ))}
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)] mb-1">Programme</dt>
          {form.days.map((d, i) => {
            const n = d.slots.filter(Boolean).length
            return (
              <dd key={i} className="flex items-center justify-between py-0.5">
                <span>Jour {i + 1}</span>
                <span className={n ? 'text-[var(--ok)] font-medium' : 'text-[var(--muted)]'}>{n ? `${n} étape${n > 1 ? 's' : ''}` : 'vide'}</span>
              </dd>
            )
          })}
        </div>
        <p className="text-xs text-[var(--muted)]">Logo : {hasLogo ? 'ajouté' : 'aucun'}</p>
      </dl>
    </aside>
  )
}

/* ───────────────────────── app ───────────────────────── */

export default function App() {
  const [authed, setAuthed] = useState(() => !!getPassword())
  const [form, setForm] = useState<Form>(loadDraft)
  // A fresh visit starts with the assistant; a saved draft resumes in the form
  const [mode, setMode] = useState<'agent' | 'form'>(() => (loadDraft().client.trim() ? 'form' : 'agent'))
  const [chat, setChat] = useState<ChatMessage[]>([])
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

  const set: Setter = patch => setForm(f => ({ ...f, ...patch }))
  const nights = form.numNights ?? Math.max(form.numDays - 1, 0)
  const datesText = form.datesOverride ?? datesLabel(form.startDate, form.numDays)

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
    'Indiquez le nom du client pour continuer.',
    '',
    'Remplissez au moins une case dans le programme.',
    '',
  ]

  function goTo(n: number) {
    setStep(n)
    setMaxReached(m => Math.max(m, n))
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
      setLogoError(e?.message || 'Image illisible')
    }
  }

  function clearLogo() {
    setLogoFile(null)
    setLogoPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null })
  }

  function reset() {
    if (result) URL.revokeObjectURL(result.url)
    setResult(null); setError(null); setForm(initialForm()); clearLogo(); setStep(0); setMaxReached(0); setDay(0)
    setChat([]); setMode('agent')
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
      fd.append('numDays', String(form.numDays))
      fd.append('numNights', String(nights))
      fd.append('numPeople', String(form.numPeople))
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
      if (e?.name === 'AbortError') setError('Génération annulée.')
      else setError(e?.message === 'Failed to fetch' ? apiMessage('', 0) : e?.message || 'Erreur inconnue')
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const stage = useMemo(() => STAGES[Math.min(STAGES.length - 1, Math.floor(elapsed / 15))], [elapsed])

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />

  const summary = <Summary form={form} nights={nights} datesText={datesText} hasLogo={!!logoFile} />

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--cream)]">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <img src="/logo_1.png" alt="Preference Events" className="h-14 w-auto mix-blend-multiply" />
            <span className="hidden sm:block h-5 w-px bg-[var(--line)]" />
            <span className="hidden sm:block text-base text-[var(--muted)]">Générateur de présentations</span>
          </div>
          <div className="flex items-center gap-1">
            {mode === 'form' && (
              <button type="button" className="btn btn-quiet" onClick={() => setMode('agent')}>
                <Icon name="chat" className="w-4 h-4" /><span className="hidden sm:inline">Assistant</span>
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => { if (confirm('Effacer le formulaire et recommencer ?')) reset() }}>
              <Icon name="refresh" className="w-4 h-4" /><span className="hidden sm:inline">Nouveau</span>
            </button>
            <button type="button" className="btn btn-quiet !text-[var(--muted)]"
              onClick={() => { sessionStorage.removeItem(AUTH_KEY); setAuthed(false) }}>
              <Icon name="logout" className="w-4 h-4" /><span className="hidden sm:inline">Déconnexion</span>
            </button>
          </div>
        </div>
      </header>

      {mode === 'agent' ? (
        <AgentScreen
          form={form}
          messages={chat}
          setMessages={setChat}
          onPatch={patch => setForm(f => applyPatch(f, patch))}
          apiUrl={API_URL}
          password={getPassword()}
          onManual={() => setMode('form')}
          onReview={() => { setMode('form'); setMaxReached(3); setStep(3) }}
          summary={summary}
        />
      ) : (
      <div className="mx-auto grid max-w-[1400px] gap-6 px-5 py-8 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[12rem_minmax(0,1fr)_19rem]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Stepper current={step} maxReached={maxReached} goTo={goTo} />
        </div>

        <main>
          <section className="card p-6 sm:p-10 rise" key={step} aria-labelledby="step-title">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--burgundy)]">Étape {step + 1} sur {STEPS.length}</p>
            <h1 id="step-title" className="font-display mt-1 text-4xl font-semibold">
              {['Informations sur l’événement', 'Hébergement', 'Programme', 'Votre présentation'][step]}
            </h1>
            <p className="mt-1.5 mb-7 text-[var(--muted)]">
              {[
                'Ces informations apparaissent sur la page de garde et dans l’introduction.',
                'Un ou plusieurs hôtels, avec le nombre de chambres réservées.',
                'Remplissez les cases de chaque journée. Les photos sont ajoutées automatiquement.',
                'Vérifiez le récapitulatif puis lancez la génération.',
              ][step]}
            </p>

            {step === 0 && (
              <StepEvent form={form} set={set} nights={nights} datesText={datesText} logoFile={logoFile}
                logoPreview={logoPreview} onLogo={onLogo} onLogoClear={clearLogo} logoError={logoError} />
            )}
            {step === 1 && <StepHotels form={form} set={set} />}
            {step === 2 && <StepProgram form={form} set={set} day={day} setDay={setDay} />}

            {step === 3 && (
              <div>
                <div className="xl:hidden mb-6">{summary}</div>

                {busy && (
                  <div className="inner p-5 rise" role="status" aria-live="polite">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-semibold">{stage}</p>
                        <p className="text-sm text-[var(--muted)]">Cela peut prendre jusqu’à 2 minutes · {elapsed} s</p>
                      </div>
                      <button type="button" className="btn btn-ghost" onClick={() => abortRef.current?.abort()}>Annuler</button>
                    </div>
                    <div className="indeterminate relative mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--sand)]" />
                  </div>
                )}

                {error && !busy && (
                  <div role="alert" className="flex gap-3 rounded-[12px] border border-[#e8c3be] bg-[#fbeceb] p-4 text-[var(--danger)] rise">
                    <Icon name="alert" className="w-5 h-5 mt-0.5 flex-none" />
                    <div><p className="font-semibold">La génération a échoué</p><p className="text-sm mt-0.5">{error}</p></div>
                  </div>
                )}

                {result && !busy && (
                  <div className="rounded-[12px] border border-[#bfd8c9] bg-[#edf6f0] p-5 rise" role="status">
                    <div className="flex items-start gap-3 text-[var(--ok)]">
                      <Icon name="check" className="w-5 h-5 mt-0.5 flex-none" strokeWidth={2.5} />
                      <div>
                        <p className="font-semibold">Présentation prête</p>
                        <p className="text-sm">{result.filename} · {(result.size / 1048576).toFixed(1)} Mo — le téléchargement a démarré.</p>
                      </div>
                    </div>
                    <a href={result.url} download={result.filename} className="btn btn-ghost mt-4 bg-white">
                      <Icon name="download" className="w-4 h-4" /> Télécharger à nouveau
                    </a>
                  </div>
                )}

                {!busy && (
                  <button type="button" onClick={generate} className="btn btn-primary mt-6 w-full !min-h-[52px] text-base">
                    <Icon name="file" className="w-5 h-5" />
                    {result ? 'Générer à nouveau' : 'Générer la présentation'}
                  </button>
                )}
              </div>
            )}
          </section>

          <div className="mt-5 flex items-center justify-between gap-3">
            <button type="button" className="btn btn-ghost" onClick={() => goTo(step - 1)} disabled={step === 0 || busy}>
              <Icon name="left" className="w-4 h-4" /> Retour
            </button>
            {step < STEPS.length - 1 && (
              <div className="flex items-center gap-3">
                {!stepValid[step] && <span className="hidden sm:block text-sm text-[var(--muted)]">{blocker[step]}</span>}
                <button type="button" className="btn btn-primary" onClick={() => goTo(step + 1)} disabled={!stepValid[step]}>
                  Continuer <Icon name="right" className="w-4 h-4" />
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

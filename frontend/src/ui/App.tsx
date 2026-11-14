import React, { useState } from 'react'

const API_URL = (import.meta as any).env?.VITE_API_URL || 'https://ppt-generator-api-8v70.onrender.com'
const WEBSITE_PASSWORD = 'PREF-2025'

const HOTEL_OPTIONS = [
  "BARCELO PALMERAIE", "BIVOUAC SOUS LES ETOILES", "DAR SABRA",
  "DOMAINE DE LA ROSERAIE", "ES SAADI", "FELLAH", "HIVERNAGE",
  "HOTEL DU GOLF, PICKALBATROS", "HOTEL IBEROSTAR", "HOTEL RADISSON",
  "INARA CAMP", "JARDINS DE LA KOUTOUBIA", "KASBAH D'IF",
  "KENZI ROSE GARDEN", "MAMOUNIA", "MOVENPICK", "PALAIS RONSARD HOTEL",
  "PARK HYATT", "PURE HOUSE", "RIAD AL JAZIRA",
  "SOFITEL MARRAKECH PALAIS IMPERIAL", "TIGMIZA", "VILLA ALBAICIN", "VILLA ANTHEA",
]

const RESTAURANT_OPTIONS = Array.from(new Set([
  "AFTER AU BABOUCHKA", "BO ZIN", "CASINO", "DAR CHERIFA", "DAR MOHA",
  "DAR SOUKKAR", "DAR ZELLIJ", "DEJEUNER A L'HOTEL", "DEJEUNER AU DADA",
  "DINER A L'HOTEL", "DINER PALAIS RONSARD", "EPICURIEN", "FLOUKA",
  "JARDIN LOTUS", "KABANA", "KASBAH BELDI DEJEUNER ET DETENTE", "KOYA",
  "KSAR EL HAMRA", "LA MAISON ARABE", "LA PAUSE", "LODGE DU DESERT",
  "LOTUS CLUB", "NARWANA", "NOUBA", "NOMAD ROOFTOP", "PALAIS GHARNATA",
  "PALAIS JAD MAHAL", "SOIREE BELDI COUNTRY CLUB",
  "SOIREE BLANCHE DANS LE DESERT D'AGAFAY", "SOIREE CAMPEMENT DAR CAID PALMERAIE",
  "SOIREE CAMPEMENT PALMERAIE", "SOIREE DANS LE DESERT",
  "TERRASSE DES EPICES", "TERRES AMANAR", "VERGER PALAIS RONSARD"
])).sort()

const CATEGORY_OPTIONS: Record<string, string[]> = {
  "Divers": ["ARRIVEE", "DEPART", "DEPART AEROPORT EN 4X4"],
  "Petit Déjeuner": ["PETIT DEJEUNER A L'HOTEL", "PETIT DEJEUNER BELDI COUNTRY CLUB", "PETIT DEJEUNER BERBERE"].sort(),
  "Restaurants": RESTAURANT_OPTIONS,
  "Activité": ["ACTIVITES A LA CARTE", "AMANAR", "APRES MIDI DE REUNION", "APRES MIDI LIBRE", "ATELIER CALIGRAPHIE", "ATELIER POTERIE", "CHALLENGE CAROSSA", "CHOIX D'ACTIVITES", "COURS DE CUISINE CHEF TARIK", "COURS DE CUISINE MEDINA", "DECOUVERTE DES SOUKS", "DETENTE BELDI COUNTRY CLUB", "EXCURSION EN 4X4", "INARA CAMP", "JOURNEE DE REUNION", "KARTING", "LODGE DU DESERT", "MATINEE DE REUNION", "MATINEE LIBRE", "MEDERSA BEN YOUSSEF", "MONTGOLFIERE", "MUSEE YSL ET JARDINS MAJORELLES", "OLYMPIADES BERBERES", "PALAIS DE LA BAHIA", "QUAD", "QUAD ET BUGGY A AGAFAY", "QUAD ET BUGGY AUTOUR DU LAC", "RALLYE KASBAH EXPRESS", "SPA", "TRANSFERT EN CALECHE", "TREK DANS L'ATLAS AVEC DEJEUNER A LA KASBAH DU TOUBKAL", "TREK DANS L'ATLAS AVEC DEJEUNER CHEZ L'HABITANT", "YOGA"].sort(),
}

const CATEGORY_ICONS: Record<string, string> = {
  "Divers": "✈",
  "Petit Déjeuner": "☀",
  "Restaurants": "🍽",
  "Activité": "⛰",
}

type HotelEntry = { hotelName: string; rooms: number }
type DayStep = {
  id: string
  category: string
  activity: string
  isManual?: boolean
  manualText?: string
}
type DayPlan = { date: string; steps: DayStep[] }

const STEPS = ['Informations', 'Hôtels', 'Programme', 'Générer']
const STEP_ICONS = ['📋', '🏨', '📅', '✨']

function WizardNav({ current, goTo, maxReached }: { current: number; goTo: (n: number) => void; maxReached: number }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-10">
      {STEPS.map((label, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <div className={`h-0.5 w-12 sm:w-20 transition-all duration-500 ${
              i <= current ? 'step-connector' : 'bg-gray-200'
            }`} />
          )}
          <button
            type="button"
            onClick={() => i <= maxReached && goTo(i)}
            className="wizard-step group"
            disabled={i > maxReached}
          >
            <div className={`wizard-step-dot ${
              i === current ? 'active' : i < current ? 'completed' : 'inactive'
            }`}>
              {i < current ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span>{STEP_ICONS[i]}</span>
              )}
            </div>
            <span className={`mt-2 text-xs font-medium transition-colors hidden sm:block ${
              i === current ? 'text-[#C45B28]' : i < current ? 'text-[#C45B28]/60' : 'text-gray-400'
            }`}>
              {label}
            </span>
          </button>
        </React.Fragment>
      ))}
    </div>
  )
}

function SectionHeader({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-1">
        <span className="text-2xl">{icon}</span>
        <h2 className="font-display text-2xl font-semibold text-[#2C1810]">{title}</h2>
      </div>
      {subtitle && <p className="text-sm text-[#8C7E74] ml-11">{subtitle}</p>}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs font-semibold uppercase tracking-wider text-[#8C7E74] mb-1.5">{children}</span>
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState("")
  const [passwordError, setPasswordError] = useState("")
  const [loginShake, setLoginShake] = useState(false)

  const [wizardStep, setWizardStep] = useState(0)
  const [maxReached, setMaxReached] = useState(0)

  const [client, setClient] = useState("")
  const [eventTitle, setEventTitle] = useState("")
  const [dates, setDates] = useState("")
  const [numDays, setNumDays] = useState(2)
  const [numNights, setNumNights] = useState(1)
  const [numPeople, setNumPeople] = useState(10)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  const [hotels, setHotels] = useState<HotelEntry[]>([
    { hotelName: HOTEL_OPTIONS[0], rooms: 1 },
  ])

  const [dayPlans, setDayPlans] = useState<DayPlan[]>([])
  const [showManualNoteModal, setShowManualNoteModal] = useState<{ dayIndex: number } | null>(null)
  const [manualNoteText, setManualNoteText] = useState("")
  const [expandedDay, setExpandedDay] = useState<number | null>(0)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  React.useEffect(() => {
    setDayPlans(prev => {
      const newPlans = Array.from({ length: numDays }, (_, i) =>
        prev[i] || { date: "", steps: [] }
      )
      return newPlans
    })
  }, [numDays])

  function goToStep(n: number) {
    setWizardStep(n)
    if (n > maxReached) setMaxReached(n)
  }

  function nextStep() {
    const next = Math.min(wizardStep + 1, STEPS.length - 1)
    goToStep(next)
  }

  function prevStep() {
    setWizardStep(Math.max(wizardStep - 1, 0))
  }

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (password === WEBSITE_PASSWORD) {
      setIsAuthenticated(true)
      setPasswordError("")
    } else {
      setPasswordError("Mot de passe incorrect")
      setPassword("")
      setLoginShake(true)
      setTimeout(() => setLoginShake(false), 500)
    }
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null
    setLogoFile(file)
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => setLogoPreview(reader.result as string)
      reader.readAsDataURL(file)
    } else {
      setLogoPreview(null)
    }
  }

  function updateHotel(index: number, patch: Partial<HotelEntry>) {
    setHotels(prev => prev.map((h, i) => (i === index ? { ...h, ...patch } : h)))
  }
  function addHotel() {
    setHotels(prev => [...prev, { hotelName: HOTEL_OPTIONS[0], rooms: 1 }])
  }
  function removeHotel(index: number) {
    setHotels(prev => prev.filter((_, i) => i !== index))
  }

  function updateDayPlan(index: number, patch: Partial<DayPlan>) {
    setDayPlans(prev => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }
  function addStepToDay(dayIndex: number) {
    const newStep: DayStep = { id: `step_${Date.now()}`, category: "", activity: "" }
    setDayPlans(prev => prev.map((d, i) =>
      i === dayIndex ? { ...d, steps: [...d.steps, newStep] } : d
    ))
  }
  function removeStepFromDay(dayIndex: number, stepId: string) {
    setDayPlans(prev => prev.map((d, i) =>
      i === dayIndex ? { ...d, steps: d.steps.filter(s => s.id !== stepId) } : d
    ))
  }
  function updateStep(dayIndex: number, stepId: string, field: keyof DayStep, value: string) {
    setDayPlans(prev => prev.map((d, i) =>
      i === dayIndex ? {
        ...d,
        steps: d.steps.map(s => {
          if (s.id !== stepId) return s
          if (field === 'category') return { ...s, category: value, activity: "" }
          return { ...s, [field]: value }
        })
      } : d
    ))
  }
  function addManualNote(dayIndex: number) {
    setShowManualNoteModal({ dayIndex })
    setManualNoteText("")
  }
  function saveManualNote() {
    if (!showManualNoteModal || !manualNoteText.trim()) return
    const dayIndex = showManualNoteModal.dayIndex
    const newManualStep: DayStep = {
      id: `manual_${Date.now()}`,
      category: "", activity: "",
      isManual: true, manualText: manualNoteText.trim()
    }
    setDayPlans(prev => prev.map((d, i) =>
      i === dayIndex ? { ...d, steps: [...d.steps, newManualStep] } : d
    ))
    setShowManualNoteModal(null)
    setManualNoteText("")
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccessMessage(null)
    try {
      if (!logoFile) {
        setError("Veuillez télécharger une image de logo.")
        setSubmitting(false)
        return
      }
      for (const [dayIdx, day] of dayPlans.entries()) {
        for (const [stepIdx, step] of day.steps.entries()) {
          if (step.isManual) continue
          if (!step.category || !step.activity) {
            setError(`Jour ${dayIdx + 1}, étape ${stepIdx + 1} est incomplète. Veuillez choisir une catégorie et une activité.`)
            setSubmitting(false)
            return
          }
        }
      }
      const fd = new FormData()
      fd.append('client', client)
      fd.append('eventTitle', eventTitle)
      fd.append('dates', dates)
      fd.append('numDays', String(numDays))
      fd.append('numNights', String(numNights))
      fd.append('numPeople', String(numPeople))
      fd.append('hotels', JSON.stringify(hotels))
      const convertedDayPlans = dayPlans.map(day => ({
        date: day.date,
        steps: day.steps.filter(s => !s.isManual).map(step => step.activity),
        manualNotes: day.steps.filter(s => s.isManual).map(step => step.manualText || "")
      }))
      fd.append('dayPlans', JSON.stringify(convertedDayPlans))
      fd.append('logo', logoFile)

      const res = await fetch(`${API_URL}/generate`, { method: 'POST', body: fd })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Request failed with ${res.status}`)
      }
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const sanitizedClient = (client || 'client').trim().replace(/[^a-zA-Z0-9_-]/g, '_')
      a.download = `presentation_marrakech_${sanitizedClient}.pptx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      setSuccessMessage(`Présentation téléchargée avec succès !`)
    } catch (err: any) {
      setError(err?.message || 'Erreur inconnue')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Login Screen ───
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4"
        style={{
          background: 'linear-gradient(135deg, #2C1810 0%, #6B2139 40%, #C45B28 100%)',
        }}>
        {/* decorative pattern */}
        <div className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-rule='evenodd'%3E%3Cpath d='M30 0l30 30-30 30L0 30z' fill-opacity='1'/%3E%3C/g%3E%3C/svg%3E")`,
            backgroundSize: '40px 40px',
          }}
        />
        <div className={`relative glass-card rounded-3xl p-10 w-full max-w-md shadow-2xl animate-fade-in-up ${loginShake ? 'animate-[shake_0.5s_ease-in-out]' : ''}`}
          style={{
            background: 'rgba(255,255,255,0.95)',
            boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
          }}>
          <div className="text-center mb-8">
            <img src="/logo_1.png" alt="Preference Events" className="w-36 h-36 object-contain mx-auto mb-4" />
            <div className="w-16 h-0.5 mx-auto mb-4" style={{ background: 'linear-gradient(90deg, var(--terracotta), var(--gold))' }} />
            <p className="text-[#8C7E74] text-sm tracking-wide">Générateur de Présentations</p>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-5">
            <div className="relative">
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mot de passe"
                className="input-field text-center text-lg tracking-widest"
                required
              />
            </div>
            {passwordError && (
              <p className="text-red-500 text-sm text-center">{passwordError}</p>
            )}
            <button type="submit" className="w-full btn-primary py-3.5 text-base tracking-wide shimmer-btn">
              Accéder
            </button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-xs text-[#8C7E74]/60">© {new Date().getFullYear()} Preference Events — Marrakech</p>
          </div>
        </div>
      </div>
    )
  }

  // ─── Main App ───
  return (
    <div className="min-h-screen" style={{ background: 'var(--cream)' }}>
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[#C45B28]/10"
        style={{ background: 'rgba(250,246,240,0.9)', backdropFilter: 'blur(12px)' }}>
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/logo_1.png" alt="Logo" className="w-10 h-10 object-contain" />
            <div>
              <h1 className="font-display text-xl font-semibold text-[#2C1810]">Preference Events</h1>
              <p className="text-xs text-[#8C7E74]">Générateur de Présentations</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setIsAuthenticated(false); setPassword("") }}
            className="text-xs text-[#8C7E74] hover:text-[#C45B28] transition-colors"
          >
            Déconnexion
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <WizardNav current={wizardStep} goTo={goToStep} maxReached={maxReached} />

        <form onSubmit={onSubmit}>
          {/* ─── Step 0: General Info ─── */}
          {wizardStep === 0 && (
            <div className="animate-fade-in-up">
              <div className="glass-card rounded-2xl p-8 shadow-sm">
                <SectionHeader icon="📋" title="Informations Générales" subtitle="Renseignez les détails du séminaire" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <FieldLabel>Nom du client</FieldLabel>
                    <input className="input-field" value={client} onChange={e => setClient(e.target.value)} placeholder="Ex: Société Dupont" />
                  </div>
                  <div>
                    <FieldLabel>Titre de l'événement</FieldLabel>
                    <input className="input-field" value={eventTitle} onChange={e => setEventTitle(e.target.value)} placeholder="Ex: Séminaire Annuel 2026" />
                  </div>
                  <div>
                    <FieldLabel>Dates du séjour</FieldLabel>
                    <input className="input-field" value={dates} onChange={e => setDates(e.target.value)} placeholder="Ex: 25 au 28 Octobre" />
                  </div>
                  <div>
                    <FieldLabel>Nombre de jours (1-8)</FieldLabel>
                    <input type="number" min={1} max={8} className="input-field" value={numDays} onChange={e => setNumDays(Number(e.target.value || 1))} />
                  </div>
                  <div>
                    <FieldLabel>Nombre de nuits</FieldLabel>
                    <input type="number" className="input-field" value={numNights} onChange={e => setNumNights(Number(e.target.value || 0))} />
                  </div>
                  <div>
                    <FieldLabel>Nombre de personnes</FieldLabel>
                    <input type="number" className="input-field" value={numPeople} onChange={e => setNumPeople(Number(e.target.value || 0))} />
                  </div>
                  <div>
                    <FieldLabel>Logo du client</FieldLabel>
                    <div className="relative">
                      {logoPreview ? (
                        <div className="flex items-center gap-4 p-3 rounded-xl border border-gray-200 bg-white/80">
                          <img src={logoPreview} alt="Logo preview" className="w-14 h-14 object-contain rounded-lg bg-gray-50 p-1" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[#2C1810] truncate">{logoFile?.name}</p>
                            <p className="text-xs text-[#8C7E74]">{logoFile && (logoFile.size / 1024).toFixed(0)} Ko</p>
                          </div>
                          <button type="button" onClick={() => { setLogoFile(null); setLogoPreview(null) }}
                            className="text-gray-400 hover:text-red-500 transition-colors p-1">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed border-gray-200 hover:border-[#C45B28]/40 cursor-pointer transition-colors bg-white/50">
                          <svg className="w-8 h-8 text-[#8C7E74] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span className="text-sm text-[#8C7E74]">Cliquez pour télécharger</span>
                          <input type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end mt-6">
                <button type="button" onClick={nextStep} className="btn-primary flex items-center gap-2">
                  Suivant
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* ─── Step 1: Hotels ─── */}
          {wizardStep === 1 && (
            <div className="animate-fade-in-up">
              <div className="glass-card rounded-2xl p-8 shadow-sm">
                <SectionHeader icon="🏨" title="Hébergement" subtitle="Sélectionnez les hôtels et le nombre de chambres" />

                <div className="space-y-4">
                  {hotels.map((h, i) => (
                    <div key={i} className="flex gap-4 items-start p-4 rounded-xl bg-white/60 border border-gray-100 animate-slide-in"
                      style={{ animationDelay: `${i * 80}ms` }}>
                      <div className="w-10 h-10 rounded-full bg-[#C45B28]/10 flex items-center justify-center flex-shrink-0 mt-1">
                        <span className="text-[#C45B28] font-semibold text-sm">{i + 1}</span>
                      </div>
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2">
                          <FieldLabel>Hôtel</FieldLabel>
                          <select className="select-field" value={h.hotelName} onChange={e => updateHotel(i, { hotelName: e.target.value })}>
                            {HOTEL_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        </div>
                        <div>
                          <FieldLabel>Chambres</FieldLabel>
                          <input type="number" min={1} className="input-field" value={h.rooms} onChange={e => updateHotel(i, { rooms: Number(e.target.value || 1) })} />
                        </div>
                      </div>
                      {hotels.length > 1 && (
                        <button type="button" onClick={() => removeHotel(i)}
                          className="mt-6 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <button type="button" onClick={addHotel}
                  className="mt-4 btn-secondary flex items-center gap-2 mx-auto">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Ajouter un hôtel
                </button>
              </div>

              <div className="flex justify-between mt-6">
                <button type="button" onClick={prevStep} className="btn-secondary flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Retour
                </button>
                <button type="button" onClick={nextStep} className="btn-primary flex items-center gap-2">
                  Suivant
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* ─── Step 2: Day Plans ─── */}
          {wizardStep === 2 && (
            <div className="animate-fade-in-up">
              <div className="glass-card rounded-2xl p-8 shadow-sm">
                <SectionHeader icon="📅" title="Programme Journalier" subtitle="Planifiez chaque journée du séminaire" />

                <div className="space-y-4">
                  {dayPlans.map((day, dayIndex) => {
                    const isExpanded = expandedDay === dayIndex
                    const stepCount = day.steps.length
                    const completedSteps = day.steps.filter(s => s.isManual || (s.category && s.activity)).length

                    return (
                      <div key={dayIndex} className="day-card">
                        {/* Day header */}
                        <button
                          type="button"
                          onClick={() => setExpandedDay(isExpanded ? null : dayIndex)}
                          className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/50 transition-colors"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl flex items-center justify-center font-display text-lg font-bold text-white"
                              style={{ background: 'linear-gradient(135deg, var(--terracotta), var(--terracotta-dark))' }}>
                              J{dayIndex + 1}
                            </div>
                            <div className="text-left">
                              <p className="font-medium text-[#2C1810]">Jour {dayIndex + 1}</p>
                              <p className="text-xs text-[#8C7E74]">
                                {day.date || 'Date non définie'} · {stepCount} étape{stepCount !== 1 ? 's' : ''}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {stepCount > 0 && (
                              <div className="flex items-center gap-1.5">
                                <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                      width: `${stepCount > 0 ? (completedSteps / stepCount) * 100 : 0}%`,
                                      background: 'linear-gradient(90deg, var(--terracotta), var(--gold))',
                                    }}
                                  />
                                </div>
                                <span className="text-xs text-[#8C7E74]">{completedSteps}/{stepCount}</span>
                              </div>
                            )}
                            <svg className={`w-5 h-5 text-[#8C7E74] transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </button>

                        {/* Day content */}
                        {isExpanded && (
                          <div className="px-6 pb-6 animate-fade-in-up">
                            <div className="mb-5">
                              <FieldLabel>Date</FieldLabel>
                              <input
                                className="input-field max-w-xs"
                                value={day.date}
                                onChange={e => updateDayPlan(dayIndex, { date: e.target.value })}
                                placeholder="Ex: 26 OCT"
                              />
                            </div>

                            {/* Steps timeline */}
                            <div className="space-y-3 mb-5">
                              {day.steps.map((step, stepIndex) => (
                                <div key={step.id} className="flex gap-4 animate-slide-in" style={{ animationDelay: `${stepIndex * 60}ms` }}>
                                  {/* Timeline line */}
                                  <div className="flex flex-col items-center pt-1">
                                    <div className={`timeline-dot ${step.isManual || (step.category && step.activity) ? 'filled' : ''}`} />
                                    {stepIndex < day.steps.length - 1 && (
                                      <div className="w-0.5 flex-1 bg-gray-200 mt-1" />
                                    )}
                                  </div>

                                  {/* Step content */}
                                  <div className="flex-1 pb-4">
                                    {step.isManual ? (
                                      <div className="flex items-center gap-3 p-3 rounded-xl bg-purple-50 border border-purple-100">
                                        <span className="text-purple-600 text-lg">📝</span>
                                        <div className="flex-1">
                                          <p className="text-xs font-semibold text-purple-600 uppercase tracking-wider">Note manuelle</p>
                                          <p className="text-sm text-purple-800 mt-0.5">{step.manualText}</p>
                                        </div>
                                        <button type="button" onClick={() => removeStepFromDay(dayIndex, step.id)}
                                          className="p-1.5 text-purple-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                          </svg>
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="p-4 rounded-xl bg-white/70 border border-gray-100">
                                        <div className="flex items-center justify-between mb-3">
                                          <span className="text-xs font-semibold text-[#8C7E74] uppercase tracking-wider">
                                            Étape {stepIndex + 1}
                                          </span>
                                          <button type="button" onClick={() => removeStepFromDay(dayIndex, step.id)}
                                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                          </button>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                          <div>
                                            <select className="select-field text-sm" value={step.category}
                                              onChange={e => updateStep(dayIndex, step.id, 'category', e.target.value)}>
                                              <option value="" disabled>Catégorie</option>
                                              {Object.keys(CATEGORY_OPTIONS).map(cat => (
                                                <option key={cat} value={cat}>{CATEGORY_ICONS[cat] || ''} {cat}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div>
                                            <select className="select-field text-sm" disabled={!step.category} value={step.activity}
                                              onChange={e => updateStep(dayIndex, step.id, 'activity', e.target.value)}>
                                              <option value="" disabled>
                                                {step.category ? "Activité" : "Choisir catégorie d'abord"}
                                              </option>
                                              {CATEGORY_OPTIONS[step.category]?.map(a => (
                                                <option key={a} value={a}>{a}</option>
                                              ))}
                                            </select>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Action buttons */}
                            <div className="flex flex-wrap gap-2 ml-7">
                              <button type="button" onClick={() => addStepToDay(dayIndex)}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-[#C45B28] bg-[#C45B28]/5 hover:bg-[#C45B28]/10 transition-colors">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                Étape
                              </button>
                              <button type="button" onClick={() => addManualNote(dayIndex)}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 transition-colors">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                Note manuelle
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="flex justify-between mt-6">
                <button type="button" onClick={prevStep} className="btn-secondary flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Retour
                </button>
                <button type="button" onClick={nextStep} className="btn-primary flex items-center gap-2">
                  Suivant
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* ─── Step 3: Review & Generate ─── */}
          {wizardStep === 3 && (
            <div className="animate-fade-in-up">
              <div className="glass-card rounded-2xl p-8 shadow-sm">
                <SectionHeader icon="✨" title="Récapitulatif" subtitle="Vérifiez les détails avant de générer la présentation" />

                {/* Summary cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                  {/* Client info */}
                  <div className="p-5 rounded-xl bg-white/70 border border-gray-100">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#8C7E74] mb-3">Client</p>
                    <p className="font-display text-lg font-semibold text-[#2C1810]">{client || '—'}</p>
                    {eventTitle && <p className="text-sm text-[#2C1810]/70 mt-0.5">{eventTitle}</p>}
                    <p className="text-sm text-[#8C7E74] mt-1">{dates || 'Dates non définies'}</p>
                    <div className="flex gap-4 mt-3 text-sm text-[#8C7E74]">
                      <span>{numDays} jour{numDays > 1 ? 's' : ''}</span>
                      <span>·</span>
                      <span>{numNights} nuit{numNights > 1 ? 's' : ''}</span>
                      <span>·</span>
                      <span>{numPeople} pers.</span>
                    </div>
                  </div>

                  {/* Logo */}
                  <div className="p-5 rounded-xl bg-white/70 border border-gray-100">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#8C7E74] mb-3">Logo</p>
                    {logoPreview ? (
                      <div className="flex items-center gap-3">
                        <img src={logoPreview} alt="Logo" className="w-16 h-16 object-contain rounded-lg bg-gray-50 p-1" />
                        <p className="text-sm text-[#2C1810]">{logoFile?.name}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-red-500 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        Logo non téléchargé
                      </p>
                    )}
                  </div>

                  {/* Hotels */}
                  <div className="p-5 rounded-xl bg-white/70 border border-gray-100">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#8C7E74] mb-3">
                      Hôtels ({hotels.length})
                    </p>
                    <div className="space-y-2">
                      {hotels.map((h, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="text-[#2C1810]">{h.hotelName}</span>
                          <span className="text-[#8C7E74] bg-gray-100 px-2 py-0.5 rounded-full text-xs">
                            {h.rooms} ch.
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Programme */}
                  <div className="p-5 rounded-xl bg-white/70 border border-gray-100">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#8C7E74] mb-3">
                      Programme ({numDays} jours)
                    </p>
                    <div className="space-y-2">
                      {dayPlans.map((day, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="text-[#2C1810]">Jour {i + 1} {day.date ? `— ${day.date}` : ''}</span>
                          <span className="text-[#8C7E74] bg-gray-100 px-2 py-0.5 rounded-full text-xs">
                            {day.steps.length} étape{day.steps.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Errors & Success */}
                {error && (
                  <div className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm animate-fade-in-up">
                    <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>{error}</p>
                  </div>
                )}

                {successMessage && (
                  <div className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-green-50 border border-green-100 text-green-700 text-sm animate-fade-in-up">
                    <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>{successMessage}</p>
                  </div>
                )}

                {/* Loading state */}
                {submitting && (
                  <div className="mb-6 p-6 rounded-xl border border-[#C45B28]/20 bg-[#C45B28]/5 animate-fade-in-up">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-10 h-10 rounded-full border-3 border-[#C45B28]/20 border-t-[#C45B28] animate-spin"
                        style={{ borderWidth: '3px' }} />
                      <div>
                        <p className="font-medium text-[#2C1810]">Génération en cours...</p>
                        <p className="text-sm text-[#8C7E74]">Cela peut prendre jusqu'à une minute</p>
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-[#C45B28]/10 rounded-full overflow-hidden">
                      <div className="h-full rounded-full loading-bar" style={{ width: '100%' }} />
                    </div>
                  </div>
                )}

                {/* Generate button */}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full shimmer-btn btn-primary py-4 text-lg font-semibold tracking-wide flex items-center justify-center gap-3 rounded-2xl"
                >
                  {submitting ? (
                    'Génération en cours…'
                  ) : (
                    <>
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Générer la Présentation
                    </>
                  )}
                </button>
              </div>

              <div className="flex justify-start mt-6">
                <button type="button" onClick={prevStep} className="btn-secondary flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Retour
                </button>
              </div>
            </div>
          )}
        </form>

        <div className="mt-8 text-center text-xs text-[#8C7E74]/50">
          © {new Date().getFullYear()} Preference Events — Marrakech
        </div>
      </main>

      {/* Manual Note Modal */}
      {showManualNoteModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in-up">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="font-display text-lg font-semibold text-[#2C1810]">Note manuelle</h3>
              <p className="text-sm text-[#8C7E74] mt-1">
                Ajoutez une note qui apparaîtra sur une diapositive vide
              </p>
            </div>
            <div className="p-6">
              <textarea
                className="input-field min-h-[120px] resize-none"
                value={manualNoteText}
                onChange={e => setManualNoteText(e.target.value)}
                placeholder="Votre note ici..."
                autoFocus
              />
            </div>
            <div className="px-6 py-4 bg-gray-50 flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => { setShowManualNoteModal(null); setManualNoteText("") }}
                className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={saveManualNote}
                disabled={!manualNoteText.trim()}
                className="px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                Ajouter la note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import React, { useMemo, useState } from 'react'

const API_URL = (import.meta as any).env?.VITE_API_URL || 'https://ppt-generator-api-8v70.onrender.com'
const WEBSITE_PASSWORD = 'PREF-2025' // Change this to your desired password

const HOTEL_OPTIONS = [
  "LES JARDINS DE LA KOUTOUBIA 5*",
  "SOFITEL MARRAKECH PALAIS IMPERIAL 5*",
  "BARCELO PALMERAIE 5*",
  "KENZI ROSE GARDEN HOTEL 5*",
]

const CATEGORY_OPTIONS = {
  "Divers": ["ARRIVEE", "DEPART", "ACTIVITES A LA CARTE", "PETIT DEJEUNER A L'HOTEL"],
  "Déjeuner": ["DEJEUNER A L'HOTEL", "LODGE DU DESERT", "KASBAH DU TOUBKAL"],
  "Activité": ["APRES MIDI LIBRE", "REUNION A L'HOTEL KOUTOUBIA", "REUNION A L'HOTEL SOFITEL", "DEPART EN 4X4", "DECOUVERTE DU DESERT EN 4X4", "COURS DE CUISINE MAROCAINE", "TEMPS LIBRE DANS LES SOUKS", "CALECHE", "TREK DANS L'ATLAS"],
  "Soirée": ["DINER A L'HOTEL KOUTOUBIA", "DINER A L'HOTEL SOFITEL", "SOIREE DANS LE DESERT", "PALAIS JAD MAHAL", "DAR ZELLIJ", "PALAIS GHARNATA", "PALAIS DAR SOUKKAR", "AFTER AU BABOUCHKA"]
}

type HotelEntry = { hotelName: string; rooms: number }
type DayStep = {
  id: string;
  category: string;
  activity: string;
}

type DayPlan = { 
  date: string; 
  steps: DayStep[];
}

export default function App() {
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState("")
  const [passwordError, setPasswordError] = useState("")
  
  // Main app state
  const [client, setClient] = useState("")
  const [dates, setDates] = useState("")
  const [numDays, setNumDays] = useState(2)
  const [numNights, setNumNights] = useState(1)
  const [numPeople, setNumPeople] = useState(10)
  const [logoFile, setLogoFile] = useState<File | null>(null)

  const [hotels, setHotels] = useState<HotelEntry[]>([
    { hotelName: HOTEL_OPTIONS[0], rooms: 1 },
  ])

  const [dayPlans, setDayPlans] = useState<DayPlan[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  React.useEffect(() => {
    setDayPlans(Array.from({ length: numDays }, (_, i) => ({ date: "", steps: [] })))
  }, [numDays])

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (password === WEBSITE_PASSWORD) {
      setIsAuthenticated(true)
      setPasswordError("")
    } else {
      setPasswordError("Incorrect password. Please try again.")
      setPassword("")
    }
  }

  function updateHotel(index: number, patch: Partial<HotelEntry>) {
    setHotels((prev) => prev.map((h, i) => (i === index ? { ...h, ...patch } : h)))
  }

  function addHotel() {
    setHotels((prev) => [...prev, { hotelName: HOTEL_OPTIONS[0], rooms: 1 }])
  }

  function removeHotel(index: number) {
    setHotels((prev) => prev.filter((_, i) => i !== index))
  }

  function updateDayPlan(index: number, patch: Partial<DayPlan>) {
    setDayPlans((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }

  function addStepToDay(dayIndex: number) {
    const newStep: DayStep = {
      id: `step_${Date.now()}`,
      category: "Divers",
      activity: "ARRIVEE"
    }
    setDayPlans((prev) => prev.map((d, i) => 
      i === dayIndex ? { ...d, steps: [...d.steps, newStep] } : d
    ))
  }

  function removeStepFromDay(dayIndex: number, stepId: string) {
    setDayPlans((prev) => prev.map((d, i) => 
      i === dayIndex ? { ...d, steps: d.steps.filter(s => s.id !== stepId) } : d
    ))
  }

  function updateStep(dayIndex: number, stepId: string, field: keyof DayStep, value: string) {
    setDayPlans((prev) => prev.map((d, i) => 
      i === dayIndex ? { 
        ...d, 
        steps: d.steps.map(s => s.id === stepId ? { ...s, [field]: value } : s)
      } : d
    ))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (!logoFile) {
        setError("Please upload a logo image.")
        setSubmitting(false)
        return
      }

      const fd = new FormData()
      fd.append('client', client)
      fd.append('dates', dates)
      fd.append('numDays', String(numDays))
      fd.append('numNights', String(numNights))
      fd.append('numPeople', String(numPeople))
      fd.append('hotels', JSON.stringify(hotels))
      // Convert day plans to the expected format
      const convertedDayPlans = dayPlans.map(day => ({
        date: day.date,
        steps: day.steps.map(step => step.activity)
      }))
      fd.append('dayPlans', JSON.stringify(convertedDayPlans))
      fd.append('logo', logoFile)

      const res = await fetch(`${API_URL}/generate`, {
        method: 'POST',
        body: fd,
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Request failed with ${res.status}`)
      }

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'presentation.pptx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err: any) {
      setError(err?.message || 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  // Password protection screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
          {/* Your Logo - LARGER SIZE */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <img 
                src="/logo_1.png" 
                alt="Your Logo" 
                className="w-50 h-50 object-contain"
              />
            </div>
          </div>
          
          <div className="text-center mb-6">
            <p className="text-gray-600 text-sm">Welcome to the PPT Generator</p>
            <p className="text-gray-500 text-xs mt-1">Please enter the access password:</p>
          </div>
          
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 text-center"
                required
              />
            </div>
            
            {passwordError && (
              <p className="text-red-600 text-sm text-center">{passwordError}</p>
            )}
            
            <button
              type="submit"
              className="w-full bg-red-600 text-white py-3 px-4 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium transition-colors"
            >
              Access PPT Generator
            </button>
          </form>
          
          <div className="mt-6 text-center">
            <p className="text-xs text-gray-400">© 2025 Preference Events</p>
          </div>
        </div>
      </div>
    )
  }

  // Main PPT Generator Application
  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-6">PPT Generator</h1>
        <form onSubmit={onSubmit} className="space-y-8">
          <section className="bg-white p-4 rounded shadow">
            <h2 className="font-medium mb-4">General</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm text-gray-600">Client</span>
                <input className="mt-1 w-full border rounded px-3 py-2" value={client} onChange={(e)=>setClient(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-sm text-gray-600">Dates</span>
                <input className="mt-1 w-full border rounded px-3 py-2" value={dates} onChange={(e)=>setDates(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-sm text-gray-600">Number of Days (1-8)</span>
                <input type="number" min={1} max={8} className="mt-1 w-full border rounded px-3 py-2" value={numDays} onChange={(e)=>setNumDays(Number(e.target.value||1))} />
              </label>
              <label className="block">
                <span className="text-sm text-gray-600">Number of Nights</span>
                <input type="number" className="mt-1 w-full border rounded px-3 py-2" value={numNights} onChange={(e)=>setNumNights(Number(e.target.value||0))} />
              </label>
              <label className="block">
                <span className="text-sm text-gray-600">Number of People</span>
                <input type="number" className="mt-1 w-full border rounded px-3 py-2" value={numPeople} onChange={(e)=>setNumPeople(Number(e.target.value||0))} />
              </label>
              <label className="block">
                <span className="text-sm text-gray-600">Logo Upload</span>
                <input type="file" accept="image/*" className="mt-1 w-full" onChange={(e)=>setLogoFile(e.target.files?.[0]||null)} />
              </label>
            </div>
          </section>

          <section className="bg-white p-4 rounded shadow">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-medium">Hotels</h2>
              <button type="button" onClick={addHotel} className="text-sm px-3 py-1 rounded bg-blue-600 text-white">Add Hotel</button>
            </div>
            <div className="space-y-3">
              {hotels.map((h, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <label className="md:col-span-8 block">
                    <span className="text-sm text-gray-600">Hotel</span>
                    <select className="mt-1 w-full border rounded px-3 py-2" value={h.hotelName} onChange={(e)=>updateHotel(i, { hotelName: e.target.value })}>
                      {HOTEL_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </label>
                  <label className="md:col-span-3 block">
                    <span className="text-sm text-gray-600">Rooms</span>
                    <input type="number" min={1} className="mt-1 w-full border rounded px-3 py-2" value={h.rooms} onChange={(e)=>updateHotel(i, { rooms: Number(e.target.value||1) })} />
                  </label>
                  <div className="md:col-span-1">
                    {hotels.length > 1 && (
                      <button type="button" onClick={()=>removeHotel(i)} className="text-sm px-3 py-2 rounded border w-full">Remove</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white p-4 rounded shadow">
            <h2 className="font-medium mb-4">Day Plans</h2>
            <div className="space-y-6">
              {dayPlans.map((day, dayIndex) => (
                <div key={dayIndex} className="border rounded p-4">
                  <div className="mb-4">
                    <label className="block mb-2">
                      <span className="text-sm font-medium text-gray-700">Day {dayIndex + 1} Date</span>
                      <input 
                        className="mt-1 w-full border rounded px-3 py-2" 
                        value={day.date} 
                        onChange={(e) => updateDayPlan(dayIndex, { date: e.target.value })} 
                        placeholder="e.g., 26 OCT"
                      />
                    </label>
                  </div>

                  {/* Timeline */}
                  <div className="relative">
                    {/* Horizontal line */}
                    <div className="absolute top-6 left-0 right-0 h-0.5 bg-gray-300"></div>
                    
                    {/* Steps */}
                    <div className="flex items-center space-x-4 mb-6">
                      {day.steps.map((step, stepIndex) => (
                        <div key={step.id} className="flex flex-col items-center">
                          {/* Step button */}
                          <button
                            type="button"
                            className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center font-medium hover:bg-blue-700 transition-colors"
                            title={`Step ${stepIndex + 1}`}
                          >
                            {stepIndex + 1}
                          </button>
                          
                          {/* Step label */}
                          <div className="mt-2 text-xs text-center max-w-24">
                            {step.activity}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Add/Remove buttons */}
                    <div className="flex gap-2 mb-4">
                      <button
                        type="button"
                        onClick={() => addStepToDay(dayIndex)}
                        className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                      >
                        + Add Step
                      </button>
                      {day.steps.length > 0 && (
                        <button
                          type="button"
                          onClick={() => removeStepFromDay(dayIndex, day.steps[day.steps.length - 1].id)}
                          className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                        >
                          - Remove Last
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Step configuration */}
                  {day.steps.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-gray-700">Configure Steps:</h4>
                      {day.steps.map((step, stepIndex) => (
                        <div key={step.id} className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-gray-50 rounded">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Step {stepIndex + 1} - Category</label>
                            <select
                              className="w-full border rounded px-2 py-1 text-sm"
                              value={step.category}
                              onChange={(e) => updateStep(dayIndex, step.id, 'category', e.target.value)}
                            >
                              {Object.keys(CATEGORY_OPTIONS).map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Activity</label>
                            <select
                              className="w-full border rounded px-2 py-1 text-sm"
                              value={step.activity}
                              onChange={(e) => updateStep(dayIndex, step.id, 'activity', e.target.value)}
                            >
                              {CATEGORY_OPTIONS[step.category as keyof typeof CATEGORY_OPTIONS]?.map(activity => (
                                <option key={activity} value={activity}>{activity}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {error && <div className="text-red-600">{error}</div>}
          <button disabled={submitting} type="submit" className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-50">
            {submitting ? 'Generating…' : 'Generate PowerPoint'}
          </button>
        </form>
        <div className="mt-6 text-sm text-gray-500">
          Tip: Supported day count up to 8. For agenda, the backend will create multiple agenda slides if needed.
        </div>
      </div>
    </div>
  )
}
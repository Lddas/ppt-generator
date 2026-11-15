// Options offered in the form. The names must match the keys of backend/index.json.

export const HOTEL_OPTIONS = [
  'BARCELO PALMERAIE', 'BIVOUAC SOUS LES ETOILES', 'DAR SABRA',
  'DOMAINE DE LA ROSERAIE', 'ES SAADI', 'FELLAH', 'HIVERNAGE',
  'HOTEL DU GOLF, PICKALBATROS', 'HOTEL IBEROSTAR', 'HOTEL RADISSON',
  'INARA CAMP', 'JARDINS DE LA KOUTOUBIA', "KASBAH D'IF",
  'KENZI ROSE GARDEN', 'MAMOUNIA', 'MOVENPICK', 'PALAIS RONSARD HOTEL',
  'PARK HYATT', 'PURE HOUSE', 'RIAD AL JAZIRA',
  'SOFITEL MARRAKECH PALAIS IMPERIAL', 'TIGMIZA', 'VILLA ALBAICIN', 'VILLA ANTHEA',
]

const RESTAURANTS = Array.from(new Set([
  'AFTER AU BABOUCHKA', 'BO ZIN', 'CASINO', 'DAR CHERIFA', 'DAR MOHA',
  'DAR SOUKKAR', 'DAR ZELLIJ', "DEJEUNER A L'HOTEL", 'DEJEUNER AU DADA',
  "DINER A L'HOTEL", 'DINER PALAIS RONSARD', 'EPICURIEN', 'FLOUKA',
  'JARDIN LOTUS', 'KABANA', 'KASBAH BELDI DEJEUNER ET DETENTE', 'KOYA',
  'KSAR EL HAMRA', 'LA MAISON ARABE', 'LA PAUSE', 'LODGE DU DESERT',
  'LOTUS CLUB', 'NARWANA', 'NOUBA', 'NOMAD ROOFTOP', 'PALAIS GHARNATA',
  'PALAIS JAD MAHAL', 'SOIREE BELDI COUNTRY CLUB',
  "SOIREE BLANCHE DANS LE DESERT D'AGAFAY", 'SOIREE CAMPEMENT DAR CAID PALMERAIE',
  'SOIREE CAMPEMENT PALMERAIE', 'SOIREE DANS LE DESERT',
  'TERRASSE DES EPICES', 'TERRES AMANAR', 'VERGER PALAIS RONSARD',
])).sort()

const BREAKFASTS = ["PETIT DEJEUNER A L'HOTEL", 'PETIT DEJEUNER BELDI COUNTRY CLUB', 'PETIT DEJEUNER BERBERE']

const ACTIVITIES = [
  'ACTIVITES A LA CARTE', 'AMANAR', 'APRES MIDI DE REUNION', 'APRES MIDI LIBRE', 'ATELIER CALIGRAPHIE',
  'ATELIER POTERIE', 'CHALLENGE CAROSSA', "CHOIX D'ACTIVITES", 'COURS DE CUISINE CHEF TARIK',
  'COURS DE CUISINE MEDINA', 'DECOUVERTE DES SOUKS', 'DETENTE BELDI COUNTRY CLUB', 'EXCURSION EN 4X4',
  'INARA CAMP', 'JOURNEE DE REUNION', 'KARTING', 'LODGE DU DESERT', 'MATINEE DE REUNION', 'MATINEE LIBRE',
  'MEDERSA BEN YOUSSEF', 'MONTGOLFIERE', 'MUSEE YSL ET JARDINS MAJORELLES', 'OLYMPIADES BERBERES',
  'PALAIS DE LA BAHIA', 'QUAD', 'QUAD ET BUGGY A AGAFAY', 'QUAD ET BUGGY AUTOUR DU LAC',
  'RALLYE KASBAH EXPRESS', 'SPA', 'TRANSFERT EN CALECHE',
  "TREK DANS L'ATLAS AVEC DEJEUNER A LA KASBAH DU TOUBKAL", "TREK DANS L'ATLAS AVEC DEJEUNER CHEZ L'HABITANT",
  'YOGA',
].sort()

const TRANSFERS = ['ARRIVEE', 'DEPART', 'DEPART AEROPORT EN 4X4']

export const GROUPS: Record<string, string[]> = {
  'Petit-déjeuner': BREAKFASTS,
  'Restaurants et soirées': RESTAURANTS,
  Activités: ACTIVITIES,
  'Arrivée et départ': TRANSFERS,
}

// The agenda of the design has 5 fixed cells per day, in this order.
export const SLOTS = [
  { key: 'breakfast', label: 'Petit-déjeuner', icon: 'sun', groups: ['Petit-déjeuner', 'Arrivée et départ', 'Activités'] },
  { key: 'morning', label: 'Matinée', icon: 'mountain', groups: ['Activités', 'Arrivée et départ', 'Petit-déjeuner'] },
  { key: 'lunch', label: 'Déjeuner', icon: 'utensils', groups: ['Restaurants et soirées', 'Activités'] },
  { key: 'afternoon', label: 'Après-midi', icon: 'compass', groups: ['Activités', 'Arrivée et départ'] },
  { key: 'dinner', label: 'Dîner', icon: 'moon', groups: ['Restaurants et soirées', 'Activités'] },
] as const

export type HotelEntry = { hotelName: string; rooms: number }
export type DayPlan = {
  dateOverride: string | null // null = computed from the start date
  slots: string[] // 5 cells, '' = empty
  notes: string[] // manual notes, one blank slide each
}

export const emptyDay = (): DayPlan => ({ dateOverride: null, slots: ['', '', '', '', ''], notes: [] })

const FR_MONTHS_ONLY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }

function addDays(iso: string, n: number): Date | null {
  const d = new Date(iso + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + n)
  return d
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function dayLabel(startDate: string, index: number): string {
  const d = startDate ? addDays(startDate, index) : null
  return d ? capitalize(d.toLocaleDateString('fr-FR', { weekday: 'long', ...FR_MONTHS_ONLY })) : ''
}

export function datesLabel(startDate: string, numDays: number): string {
  const first = startDate ? addDays(startDate, 0) : null
  const last = startDate ? addDays(startDate, numDays - 1) : null
  if (!first || !last) return ''
  const year = last.getFullYear()
  if (numDays <= 1) return `${first.toLocaleDateString('fr-FR', FR_MONTHS_ONLY)} ${year}`
  if (first.getMonth() === last.getMonth()) {
    return `${first.getDate()} au ${last.toLocaleDateString('fr-FR', FR_MONTHS_ONLY)} ${year}`
  }
  return `${first.toLocaleDateString('fr-FR', FR_MONTHS_ONLY)} au ${last.toLocaleDateString('fr-FR', FR_MONTHS_ONLY)} ${year}`
}

export type Form = {
  client: string
  eventTitle: string
  startDate: string
  datesOverride: string | null
  numDays: number
  numNights: number | null
  numPeople: number
  hotels: HotelEntry[]
  days: DayPlan[]
}

export const initialForm = (): Form => ({
  client: '',
  eventTitle: '',
  startDate: '',
  datesOverride: null,
  numDays: 3,
  numNights: null,
  numPeople: 20,
  hotels: [],
  days: [emptyDay(), emptyDay(), emptyDay()],
})


export const SLOT_KEYS = ['breakfast', 'morning', 'lunch', 'afternoon', 'dinner']

/** The form after applying what the assistant understood (already checked by the server). */
export function applyPatch(form: Form, patch: any): Form {
  const next: Form = { ...form }
  for (const key of ['client', 'eventTitle', 'numDays', 'numNights', 'numPeople'] as const) {
    if (patch[key] !== undefined) (next as any)[key] = patch[key]
  }
  if (patch.startDate !== undefined) {
    next.startDate = patch.startDate
    next.datesOverride = null
  }
  if (patch.hotels) next.hotels = patch.hotels
  next.days = Array.from({ length: next.numDays }, (_, i) => next.days[i] || emptyDay())
  for (const entry of patch.days || []) {
    const i = entry.day - 1
    if (i < 0 || i >= next.days.length) continue
    const day = { ...next.days[i], slots: [...next.days[i].slots] }
    for (const [key, value] of Object.entries(entry.slots || {})) {
      const k = SLOT_KEYS.indexOf(key)
      if (k >= 0) day.slots[k] = value as string
    }
    if (entry.notes) day.notes = entry.notes
    next.days[i] = day
  }
  return next
}

import React, { useMemo, useState } from 'react'

const API_URL = (import.meta as any).env?.VITE_API_URL || 'https://ppt-generator-api-8v70.onrender.com'
const WEBSITE_PASSWORD = 'PREF-2024' // Change this to your desired password

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
  console.log('App component rendering') // Debug log
  
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState("")
  const [passwordError, setPasswordError] = useState("")
  
  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    console.log('Password submitted:', password) // Debug log
    if (password === WEBSITE_PASSWORD) {
      console.log('Password correct, setting authenticated to true') // Debug log
      setIsAuthenticated(true)
      setPasswordError("")
    } else {
      setPasswordError("Incorrect password. Please try again.")
      setPassword("")
    }
  }

  // Password protection screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
          {/* Your Logo */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <img 
                src="/logo_1.png" 
                alt="Your Logo" 
                className="w-24 h-24 object-contain"
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
            <p className="text-xs text-gray-400">© 2024 Preference Events</p>
          </div>
        </div>
      </div>
    )
  }

  // SUPER SIMPLE MAIN APP
  console.log('Rendering main app, isAuthenticated:', isAuthenticated) // Debug log
  
  return (
    <div className="min-h-screen bg-green-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-green-800 mb-8">🎉 SUCCESS! MAIN APP IS WORKING!</h1>
        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h2 className="text-2xl font-semibold mb-4">PPT Generator</h2>
          <p className="text-gray-600 mb-4">The main app is now loading correctly!</p>
          <p className="text-sm text-gray-500">Password: PREF-2024</p>
        </div>
      </div>
    </div>
  )
}



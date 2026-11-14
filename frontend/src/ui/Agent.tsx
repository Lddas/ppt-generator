import React, { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { Form } from './data'

export type ChatMessage = { role: 'user' | 'model' | 'error'; text: string }

const GREETING: ChatMessage = {
  role: 'model',
  text: 'Salut ! Je suis l’assistant Preference Events. Raconte-moi ton séminaire et je remplis tout à ta place. On commence : quel est le nom du client ?',
}

const EXAMPLES = [
  'Séminaire pour HOYA, 40 personnes, du 21 au 23 novembre',
  'Je veux 2 nuits au Sofitel',
  'Programme : quad le matin et dîner dans le désert',
]

const SpeechRecognitionApi: any =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined

/** What the assistant needs to know of the form: no files, no UI state. */
const forAgent = (form: Form) => ({
  client: form.client, eventTitle: form.eventTitle, startDate: form.startDate,
  numDays: form.numDays, numNights: form.numNights, numPeople: form.numPeople,
  hotels: form.hotels, days: form.days.map(d => ({ slots: d.slots, notes: d.notes })),
})

export default function AgentScreen({ form, onPatch, messages, setMessages, apiUrl, password, onManual, onReview, summary }: {
  form: Form
  onPatch: (patch: any) => void
  messages: ChatMessage[]
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  apiUrl: string
  password: string
  onManual: () => void
  onReview: () => void
  summary: React.ReactNode
}) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [listening, setListening] = useState(false)
  const [speak, setSpeak] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const recognition = useRef<any>(null)
  const sendRef = useRef<(text: string) => void>(() => {})

  const shown = messages.length ? messages : [GREETING]

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])
  useEffect(() => () => { recognition.current?.abort(); window.speechSynthesis?.cancel() }, [])

  async function send(raw: string) {
    const text = raw.trim()
    if (!text || busy) return
    window.speechSynthesis?.cancel()
    setInput('')
    const history = [...messages, { role: 'user' as const, text }]
    setMessages(history)
    setBusy(true)
    setDone(false)
    try {
      const res = await fetch(`${apiUrl}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-App-Password': password },
        body: JSON.stringify({
          messages: history.filter(m => m.role !== 'error').map(m => ({ role: m.role, text: m.text })),
          form: forAgent(form),
        }),
      })
      if (!res.ok) {
        let detail = `Erreur ${res.status}`
        try { detail = (await res.json()).detail || detail } catch { /* not JSON */ }
        throw new Error(detail)
      }
      const data = await res.json()
      onPatch(data.patch || {})
      setMessages([...history, { role: 'model', text: data.reply }])
      setDone(!!data.done)
      if (speak && window.speechSynthesis) {
        const utterance = new SpeechSynthesisUtterance(data.reply)
        utterance.lang = 'fr-FR'
        window.speechSynthesis.speak(utterance)
      }
    } catch (e: any) {
      const offline = e?.message === 'Failed to fetch'
      setMessages([...history, {
        role: 'error',
        text: offline ? 'Le serveur ne répond pas. Réessaie dans un instant, ou remplis le formulaire à la main.' : e.message,
      }])
    } finally {
      setBusy(false)
    }
  }
  sendRef.current = send

  function toggleMic() {
    if (listening) { recognition.current?.stop(); return }
    window.speechSynthesis?.cancel()
    const r = new SpeechRecognitionApi()
    r.lang = 'fr-FR'
    r.interimResults = true
    r.continuous = false
    r.onresult = (event: any) => {
      let text = ''
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript
      setInput(text)
      if (event.results[event.results.length - 1].isFinal) sendRef.current(text)
    }
    r.onerror = () => setListening(false)
    r.onend = () => setListening(false)
    recognition.current = r
    setListening(true)
    r.start()
  }

  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <section className="card flex min-h-[70vh] flex-col rise" aria-label="Assistant">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] p-6 sm:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--burgundy)]">Assistant</p>
            <h1 className="font-display mt-1 text-3xl font-semibold sm:text-4xl">Parle-moi de ton séminaire</h1>
            <p className="mt-1.5 text-[var(--muted)]">Je pose les questions et je remplis le formulaire au fur et à mesure.</p>
          </div>
          <button type="button" className="btn btn-ghost flex-none" onClick={onManual}>
            Remplir manuellement
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-6 sm:px-8" role="log" aria-live="polite">
          {shown.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <p className={`max-w-[85%] whitespace-pre-wrap rounded-[18px] px-4 py-3 leading-relaxed ${
                m.role === 'user'
                  ? 'rounded-br-[6px] bg-[var(--burgundy)] text-white'
                  : m.role === 'error'
                    ? 'rounded-bl-[6px] border border-[#e8c3be] bg-[#fbeceb] text-[var(--danger)]'
                    : 'rounded-bl-[6px] border border-[var(--line)] bg-[var(--cream)]'
              }`}>{m.text}</p>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start" role="status" aria-label="L’assistant écrit">
              <p className="flex gap-1.5 rounded-[18px] rounded-bl-[6px] border border-[var(--line)] bg-[var(--cream)] px-4 py-4">
                {[0, 1, 2].map(i => (
                  <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-[var(--taupe)]" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </p>
            </div>
          )}
          {done && !busy && (
            <div className="rounded-[14px] border border-[#bfd8c9] bg-[#edf6f0] p-4 rise">
              <p className="font-semibold text-[var(--ok)]">Tout est rempli.</p>
              <p className="mt-0.5 text-sm text-[var(--ok)]">Tu peux vérifier le récapitulatif et générer la présentation, ou continuer à ajuster ici.</p>
              <button type="button" className="btn btn-primary mt-3" onClick={onReview}>
                Vérifier et générer <Icon name="right" className="w-4 h-4" />
              </button>
            </div>
          )}
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {EXAMPLES.map(example => (
                <button key={example} type="button" className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--muted)] transition-colors hover:border-[var(--taupe)] hover:text-[var(--ink)]"
                  onClick={() => setInput(example)}>
                  {example}
                </button>
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form className="border-t border-[var(--line)] p-4 sm:px-8" onSubmit={e => { e.preventDefault(); send(input) }}>
          <div className="flex items-end gap-2">
            <textarea
              className="field min-h-[3.25rem] flex-1 resize-none"
              rows={1}
              value={input}
              placeholder={listening ? 'Je t’écoute…' : 'Écris ou dicte ta réponse…'}
              aria-label="Ton message"
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
            />
            {SpeechRecognitionApi && (
              <button type="button" onClick={toggleMic} aria-pressed={listening}
                aria-label={listening ? 'Arrêter la dictée' : 'Dicter'}
                className={`btn !px-0 w-[3.25rem] !min-h-[3.25rem] ${listening ? 'btn-primary animate-pulse' : 'btn-ghost'}`}>
                <Icon name="mic" className="w-5 h-5" />
              </button>
            )}
            <button type="submit" className="btn btn-primary !px-0 w-[3.25rem] !min-h-[3.25rem]" disabled={!input.trim() || busy} aria-label="Envoyer">
              <Icon name="send" className="w-5 h-5" />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-[var(--muted)]">
            <span>Entrée pour envoyer · Maj+Entrée pour un retour à la ligne</span>
            {'speechSynthesis' in window && (
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={speak} onChange={e => { setSpeak(e.target.checked); if (!e.target.checked) window.speechSynthesis.cancel() }} />
                Lire les réponses à voix haute
              </label>
            )}
          </div>
        </form>
      </section>

      <div>{summary}</div>
    </div>
  )
}

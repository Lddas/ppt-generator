import React, { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { Form } from './data'

export type Choices = { kind: string; label: string; options: string[] }
export type ChatMessage = { role: 'user' | 'model' | 'error'; text: string; choices?: Choices | null }

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
  const logRef = useRef<HTMLDivElement>(null)
  const recognition = useRef<any>(null)
  const sendRef = useRef<(text: string) => void>(() => {})

  const shown = messages.length ? messages : [GREETING]

  // The conversation scrolls inside its own frame and always follows the latest message
  useEffect(() => {
    const log = logRef.current
    if (!log) return
    // a list of choices is tall: keep the question that goes with it in view
    const last = log.querySelector<HTMLElement>('[data-last-choices]')
    log.scrollTo({ top: last ? Math.max(last.offsetTop - 16, 0) : log.scrollHeight, behavior: 'smooth' })
  }, [messages, busy, done])
  useEffect(() => () => { recognition.current?.abort(); window.speechSynthesis?.cancel() }, [])

  async function send(raw: string) {
    const text = raw.trim()
    if (!text || busy) return
    window.speechSynthesis?.cancel()
    setInput('')
    const history: ChatMessage[] = [...messages, { role: 'user' as const, text }]
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
      setMessages([...history, { role: 'model', text: data.reply, choices: data.choices || null }])
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
    <div className="mx-auto grid max-w-[1400px] items-start gap-6 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <section className="card flex h-[calc(100vh-8.5rem)] min-h-[34rem] flex-col rise" aria-label="Assistant">
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

        <div ref={logRef} className="relative min-h-0 flex-1 space-y-4 overflow-y-auto p-6 sm:px-8" role="log" aria-live="polite">
          {shown.map((m, i) => (
            <div key={i} data-last-choices={m.choices && i === shown.length - 1 && !busy ? '' : undefined}
              className={`flex flex-col gap-3 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <p className={`max-w-[85%] whitespace-pre-wrap rounded-[18px] px-4 py-3 leading-relaxed ${
                m.role === 'user'
                  ? 'rounded-br-[6px] bg-[var(--burgundy)] text-white'
                  : m.role === 'error'
                    ? 'rounded-bl-[6px] border border-[#e8c3be] bg-[#fbeceb] text-[var(--danger)]'
                    : 'rounded-bl-[6px] border border-[var(--line)] bg-[var(--cream)]'
              }`}>{m.text}</p>
              {m.choices && i === shown.length - 1 && !busy && (
                <ChoicePicker choices={m.choices} onPick={name => send(name)} />
              )}
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
              <p className="mt-0.5 text-sm text-[var(--ok)]">Ouvre le récapitulatif pour tout relire, modifier si besoin, puis générer la présentation. Tu peux aussi continuer à ajuster ici.</p>
              <button type="button" className="btn btn-primary mt-3" onClick={onReview}>
                Voir le récapitulatif <Icon name="right" className="w-4 h-4" />
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


/** Clickable list shown under the assistant's question: search, scroll, one click to choose. */
function ChoicePicker({ choices, onPick }: { choices: Choices; onPick: (name: string) => void }) {
  const [query, setQuery] = useState('')
  const normalise = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const shown = choices.options.filter(o => normalise(o).includes(normalise(query)))
  const icon = choices.kind === 'hotels' ? 'bed' : choices.kind === 'meals' ? 'utensils' : choices.kind === 'breakfasts' ? 'sun' : 'compass'
  return (
    <div className="w-full max-w-[34rem] rounded-[16px] border border-[var(--line)] bg-white p-3 shadow-sm rise">
      <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
        {choices.label} · {choices.options.length}
      </p>
      {choices.options.length > 7 && (
        <input className="field mb-2 !min-h-[2.6rem]" value={query} placeholder="Rechercher…" aria-label={`Rechercher parmi les ${choices.label}`}
          onChange={e => setQuery(e.target.value)} />
      )}
      <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {shown.map(option => (
          <li key={option}>
            <button type="button" onClick={() => onPick(option)}
              className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-[0.95rem] transition-colors hover:bg-[var(--sand)] focus-visible:bg-[var(--sand)]">
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[var(--cream)] text-[var(--burgundy)]">
                <Icon name={icon} className="w-3.5 h-3.5" />
              </span>
              <span className="flex-1">{option}</span>
              <Icon name="right" className="w-4 h-4 text-[var(--taupe)]" />
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-3 text-sm text-[var(--muted)]">Aucun résultat.</li>}
      </ul>
    </div>
  )
}

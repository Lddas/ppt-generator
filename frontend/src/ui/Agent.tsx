import React, { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { Form } from './data'
import { Speaker, VoiceDetector } from './voice'
import Orb from './Orb'
import { useLang, useT } from './i18n'

export type Choices = { kind: string; label: string; options: string[]; open?: boolean }
export type ChatMessage = { role: 'user' | 'model' | 'error'; text: string; choices?: Choices | null; live?: boolean }

const TEXTS = {
  fr: {
    startConversation: 'Démarrer la conversation', startMic: 'Parler au micro', startType: 'Écrire', startHint: 'Comment veux-tu qu’on commence ?', retry: 'Je n’ai pas bien compris, tu peux répéter ?',
    greeting: 'Salut ! Je suis l’assistant Preference Events. Raconte-moi ton séminaire et je remplis tout à ta place. Quand tu hésites (hôtel, restaurant, activité…), demande-moi les options et je te les montre. On commence : quel est le nom du client ?',
    thinking: 'Je réfléchis…', talking: 'Je parle… (parle ou clique sur la bulle pour me couper)', listening: 'Je t’écoute, parle…', dictating: 'Je t’écoute…', typing: 'Écris ou dicte…',
    conversation: 'Conversation', stop: 'Arrêter', see: 'Voir les',
    allDone: 'Tout est rempli.', doneHelp: 'Ouvre le récapitulatif pour tout relire, modifier si besoin, puis générer la présentation. Tu peux aussi continuer à ajuster ici.',
    recap: 'Voir le récapitulatif', voiceDown: 'La voix de l’assistant est indisponible pour le moment (quota Gemini atteint). Les réponses restent écrites, tu peux continuer à parler.', micBlocked: 'Le micro est bloqué. Autorise-le pour ce site dans les réglages du navigateur.',
    labels: {} as Record<string, string>,
  },
  en: {
    startConversation: 'Start the conversation', startMic: 'Use the microphone', startType: 'Type', startHint: 'How would you like to start?', retry: 'I didn’t quite get that, could you say it again?',
    greeting: 'Hi! I’m the Preference Events assistant. Tell me about your seminar and I’ll fill everything in for you. When you’re unsure (hotel, restaurant, activity…), ask me for the options and I’ll show them. Let’s start: what’s the client’s name?',
    thinking: 'Thinking…', talking: 'Speaking… (talk or click the orb to interrupt)', listening: 'I’m listening, go ahead…', dictating: 'Listening…', typing: 'Type or dictate…',
    conversation: 'Conversation', stop: 'Stop', see: 'See the',
    allDone: 'Everything is filled in.', doneHelp: 'Open the summary to review everything, edit if needed, then generate the presentation. You can also keep adjusting here.',
    recap: 'See the summary', voiceDown: 'The assistant’s voice is unavailable right now (Gemini quota reached). Replies stay in writing, you can keep talking.', micBlocked: 'The microphone is blocked. Allow it for this site in your browser settings.',
    labels: { hotels: 'hotels', breakfasts: 'breakfasts', meals: 'restaurants & evenings', activities: 'activities', activities_morning: 'morning activities', activities_afternoon: 'afternoon activities' } as Record<string, string>,
  },
}

const SpeechRecognitionApi: any =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined

/** What the assistant needs to know of the form: no files, no UI state. */
const forAgent = (form: Form, hasLogo: boolean, known: Set<string>) => ({
  hasLogo,
  client: form.client, eventTitle: form.eventTitle,
  // what was never given stays null: the assistant must ask for it instead of trusting the form's defaults
  startDate: known.has('startDate') ? form.startDate : null,
  numDays: known.has('numDays') ? form.numDays : null,
  numNights: known.has('numNights') ? form.numNights : null,
  numPeople: known.has('numPeople') ? form.numPeople : null,
  departureCities: known.has('departureCities') ? form.departureCities : null,
  hotels: form.hotels, days: form.days.map(d => ({ slots: d.slots, notes: d.notes })),
})

export default function AgentScreen({ form, known, onPatch, messages, setMessages, apiUrl, password, onManual, onReview, onReset, logoFile, onLogo, onLogoClear, summary }: {
  form: Form
  known: Set<string>
  onPatch: (patch: any) => void
  messages: ChatMessage[]
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  apiUrl: string
  password: string
  onManual: () => void
  onReview: () => void
  onReset: () => void
  logoFile: File | null
  onLogo: (file: File | null) => void
  onLogoClear: () => void
  summary: React.ReactNode
}) {
  const { lang } = useLang()
  const tt = useT()
  const t = TEXTS[lang]
  const GREETING: ChatMessage = { role: 'model', text: t.greeting }
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [listening, setListening] = useState(false)
  const [conversation, setConversation] = useState(false) // hands-free: it talks, then listens again
  const [speaking, setSpeaking] = useState(false)
  const [heardRaw, setHeardRaw] = useState('') // what the micro picks up while the assistant talks (shown, so you can see it hears you)
  const [revealing, setRevealing] = useState(-1) // index of the reply being written out, -1 when none
  const [go, setGo] = useState(true) // false while a spoken reply waits for its first sound
  const stick = useRef(true) // the log follows the latest message only while the person is at the bottom
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [opened, setOpened] = useState<Set<number>>(new Set()) // « Voir les options » buttons already clicked
  const conversationRef = useRef(false)
  const busyRef = useRef(false)
  const logRef = useRef<HTMLDivElement>(null)
  const recognition = useRef<any>(null)
  const sendRef = useRef<(text: string) => void>(() => {})
  const speaker = useRef<Speaker | null>(null)
  const detector = useRef(new VoiceDetector())
  const spokenId = useRef(0)
  const guard = useRef<string | null>(null) // what the assistant is saying, while it talks
  const skipResults = useRef(0)
  const voiceNotice = useRef(false)
  const resultCount = useRef(0)
  const recognitionOn = useRef(false)
  const interruptRef = useRef<() => void>(() => {})
  const getLevel = React.useCallback(() => detector.current.level, [])
  if (!speaker.current) speaker.current = new Speaker(apiUrl, password)

  const shown = messages

  // The conversation scrolls inside its own frame and always follows the latest message
  useEffect(() => {
    const log = logRef.current
    if (!log) return
    // a list of choices is tall: keep the question that goes with it in view
    if (!stick.current) return // the person scrolled up to read: do not drag them back down
    const last = log.querySelector<HTMLElement>('[data-last-choices]')
    log.scrollTo({ top: last ? Math.max(last.offsetTop - 16, 0) : log.scrollHeight, behavior: 'smooth' })
  }, [messages, busy, done, opened, revealing])
  useEffect(() => { if (messages[messages.length - 1]?.role === 'user') stick.current = true }, [messages]) // sending brings you back down
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (conversationRef.current && guard.current !== null && (e.key === ' ' || e.key === 'Escape')) { e.preventDefault(); interruptRef.current() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { speaker.current?.stop(); recognition.current?.abort(); setSpeaking(false); setListening(false) }, [lang])
  useEffect(() => () => { conversationRef.current = false; recognition.current?.abort(); speaker.current?.stop(); detector.current.close() }, [])

  async function send(raw: string) {
    const text = raw.trim()
    if (!text || busy) return
    speaker.current?.stop()
    setInput('')
    const history: ChatMessage[] = [...messages, { role: 'user' as const, text }]
    setMessages(history)
    setBusy(true)
    busyRef.current = true
    setDone(false)
    let failed = false
    try {
      const res = await fetch(`${apiUrl}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-App-Password': password },
        body: JSON.stringify({
          messages: history.filter(m => m.role !== 'error').map(m => ({ role: m.role, text: m.text })),
          form: forAgent(form, !!logoFile, known),
          language: lang,
          voice: conversationRef.current,
        }),
      })
      if (!res.ok) {
        let detail = `Erreur ${res.status}`
        try { detail = (await res.json()).detail || detail } catch { /* not JSON */ }
        throw new Error(detail)
      }
      const data = await res.json()
      onPatch(data.patch || {})
      setMessages([...history, { role: 'model', text: data.reply, choices: data.choices || null, live: true }])
      setRevealing(history.length)
      setGo(!conversationRef.current) // spoken: the text starts with the voice
      setDone(!!data.done)
      if (conversationRef.current) speakAloud(data.reply)
    } catch (e: any) {
      failed = true
      const offline = e?.message === 'Failed to fetch'
      const isAuth = /mot de passe|password/i.test(e?.message || '')
      setMessages([...history, {
        role: 'error', // shown like a normal reply: people do not know what a technical error means
        text: offline ? tt('Le serveur ne répond pas. Réessaie dans un instant, ou remplis le formulaire à la main.', 'The server is not answering. Try again in a moment, or fill in the form by hand.')
          : isAuth ? e.message : t.retry,
      }])
    } finally {
      busyRef.current = false
      setBusy(false)
      if (failed && conversationRef.current) setTimeout(startListening, 300) // let the person try again
    }
  }
  sendRef.current = send

  interruptRef.current = interrupt

  /** Reads a reply with the Gemini voice. In conversation mode the person can talk over it, and the micro reopens afterwards. */
  const words = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) || []

  const STOP_WORDS = new Set(['stop', 'attends', 'attend', 'arrete', 'pause', 'non', 'wait', 'hold', 'no', 'bon', 'ok', 'okay', 'ecoute', 'minute', 'sec'])

  /** Did the person cut in? The micro also hears the assistant through the speakers, so only words that are NOT the assistant's count. */
  function isInterruption(heard: string, spoken: string) {
    const said = [...new Set(words(spoken))]
    const known = (w: string) => said.some(s => s === w || (s.length > 3 && w.length > 3 && s.slice(0, 4) === w.slice(0, 4)))
    const mine = words(heard)
    return mine.some(w => STOP_WORDS.has(w) || (w.length > 1 && !known(w))) // any word that is not the assistant's own cuts in
  }

  /** The person talks over the assistant (voice, tap on the orb, space bar): it stops and the listening goes on. */
  function interrupt() {
    setRevealing(-1)
    setHeardRaw('')
    spokenId.current++
    speaker.current?.stop()
    detector.current.disarm()
    setSpeaking(false)
    guard.current = null
    skipResults.current = resultCount.current
    if (!recognitionOn.current) startListening()
  }

  /** Reads a reply with the Gemini voice. In conversation mode the micro stays open while it talks, so the person can cut in. */
  function speakAloud(text: string) {
    const id = ++spokenId.current
    setHeardRaw('')
    setSpeaking(true)
    if (conversationRef.current) {
      detector.current.arm(interrupt)
      startListening(text)
    }
    speaker.current!.say(text, () => { if (id === spokenId.current) setGo(true) }).then(result => {
      if (id !== spokenId.current) return // interrupted, or a newer reply took over
      setGo(true)
      if (result === 'unavailable' && !voiceNotice.current) {
        voiceNotice.current = true
        setMessages(m => [...m, { role: 'error', text: t.voiceDown }])
      }
      detector.current.disarm()
      setSpeaking(false)
      if (conversationRef.current) startListening()
    })
  }

  /** With `guardText` (what the assistant is saying) it listens during the assistant's speech and only reacts to words that are not its own. */
  function startListening(guardText?: string) {
    if (!SpeechRecognitionApi || busyRef.current) return
    if (!guardText) speaker.current?.stop()
    recognition.current?.abort()
    const r = new SpeechRecognitionApi()
    r.lang = lang === 'en' ? 'en-US' : 'fr-FR'
    r.interimResults = true
    r.continuous = !!guardText
    guard.current = guardText ?? null
    skipResults.current = 0
    resultCount.current = 0
    let heard = false
    r.onstart = () => { recognitionOn.current = true }
    r.onresult = (event: any) => {
      resultCount.current = event.results.length
      const latest = event.results[event.results.length - 1]
      if (guard.current !== null) {
        setHeardRaw(latest[0].transcript)
        if (!isInterruption(latest[0].transcript, guard.current)) { skipResults.current = event.results.length; return }
        interrupt()
        skipResults.current = Math.max(0, event.results.length - 1) // keep the words that cut in
      }
      let text = ''
      for (let i = skipResults.current; i < event.results.length; i++) text += event.results[i][0].transcript
      if (!text.trim()) return
      setInput(text)
      if (latest.isFinal && !busyRef.current) { heard = true; sendRef.current(text); r.stop() }
    }
    r.onerror = (event: any) => {
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        conversationRef.current = false
        setConversation(false)
        setMessages(m => [...m, { role: 'error', text: t.micBlocked }])
      }
    }
    r.onend = () => {
      recognitionOn.current = false
      setListening(false)
      if (recognition.current !== r) return // replaced by a newer one
      // in conversation mode a silence just restarts the listening (still guarded while the assistant talks)
      if (conversationRef.current && !heard && !busyRef.current) {
        setTimeout(() => { if (conversationRef.current && !busyRef.current && recognition.current === r) startListening(guard.current ?? undefined) }, 300)
      }
    }
    recognition.current = r
    setListening(!guardText)
    try { r.start() } catch { setListening(false) }
  }

  function toggleMic() {
    speaker.current?.unlock()
    if (listening) { recognition.current?.stop(); return }
    startListening()
  }

  /** First screen: nothing is written until the person picks how to talk. Then the greeting is written out. */
  async function begin(how: 'conversation' | 'mic' | 'type') {
    setMessages([{ role: 'model', text: t.greeting, live: true }])
    setRevealing(0)
    setGo(how !== 'conversation')
    if (how === 'conversation') { await toggleConversation(); if (!conversationRef.current) setGo(true) }
    else if (how === 'mic') { speaker.current?.unlock(); startListening() }
    else setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function toggleConversation() {
    const next = !conversationRef.current
    conversationRef.current = next
    setConversation(next)
    if (next) {
      speaker.current?.unlock()
      await detector.current.open() // without the micro open the person simply cannot interrupt
      if (!conversationRef.current) return
      // the last question is read out loud, then the micro opens
      const last = [...messages].reverse().find(m => m.role === 'model') || GREETING
      if (!busyRef.current) speakAloud(last.text)
      else startListening()
    } else {
      recognition.current?.abort()
      speaker.current?.stop()
      detector.current.close()
      setSpeaking(false)
      setListening(false)
    }
  }

  return (
    <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] items-start gap-4 px-3 py-4 sm:gap-6 sm:px-5 sm:py-8 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <section className="card flex h-[calc(100dvh-7rem)] min-h-[30rem] min-w-0 flex-col rise sm:h-[calc(100vh-8.5rem)] sm:min-h-[34rem]" aria-label="Assistant">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--line)] px-4 py-3 sm:px-6 sm:py-3.5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--burgundy)]">{tt('Assistant', 'Assistant')}</p>
            <h1 className="font-display text-lg font-semibold sm:text-xl">{tt('Parle-moi de ton séminaire', 'Tell me about your seminar')}</h1>
          </div>
          <div className="flex flex-none gap-1.5">
            <button type="button" className="btn btn-quiet !min-h-[2.25rem] !px-3 text-sm" onClick={onReset}>
              <Icon name="refresh" className="w-4 h-4" /> {tt('Recommencer', 'Start over')}
            </button>
            <button type="button" className="btn btn-ghost !min-h-[2.25rem] !px-3 text-sm" onClick={onManual}>
              {tt('Remplir à la main', 'Fill in by hand')}
            </button>
          </div>
        </header>

        {!messages.length ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 py-6 text-center rise">
            <p className="text-[15px] text-[var(--muted)]">{t.startHint}</p>
            <div className="flex w-full max-w-sm flex-col gap-2.5">
              {SpeechRecognitionApi && (
                <button type="button" className="btn btn-primary !min-h-[3rem]" onClick={() => begin('conversation')}>
                  <Icon name="wave" className="w-5 h-5" /> {t.startConversation}
                </button>
              )}
              {SpeechRecognitionApi && (
                <button type="button" className="btn btn-ghost !min-h-[3rem] bg-white" onClick={() => begin('mic')}>
                  <Icon name="mic" className="w-5 h-5" /> {t.startMic}
                </button>
              )}
              <button type="button" className="btn btn-ghost !min-h-[3rem] bg-white" onClick={() => begin('type')}>
                <Icon name="chat" className="w-5 h-5" /> {t.startType}
              </button>
            </div>
          </div>
        ) : (
        <div ref={logRef} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 }}
          className="relative min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-6 sm:py-5" role="log" aria-live="polite">
          {shown.map((m, i) => (
            <div key={i} data-last-choices={m.choices && i === shown.length - 1 && !busy && (m.choices.open || opened.has(i) || m.choices.kind === 'logo') ? '' : undefined}
              className={`flex flex-col gap-3 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <p className={`max-w-[85%] whitespace-pre-wrap rounded-[16px] px-3.5 py-2.5 text-[15px] leading-relaxed ${
                m.role === 'user'
                  ? 'rounded-br-[6px] bg-[var(--burgundy)] text-white'
                  : m.role === 'error'
                    ? 'rounded-bl-[6px] border border-[var(--line)] bg-[var(--cream)]'
                    : 'rounded-bl-[6px] border border-[var(--line)] bg-[var(--cream)]'
              }`} onClick={i === revealing ? () => setRevealing(-1) : undefined}>
                {i === revealing && m.live ? <Typed text={m.text} run={go} cps={conversation ? 17 : 70} onDone={() => setRevealing(r => (r === i ? -1 : r))} /> : m.text}
              </p>
              {m.choices && i === shown.length - 1 && !busy && revealing === -1 && (
                m.choices.kind === 'logo' ? (
                  <LogoPicker logoFile={logoFile} onLogo={onLogo} onClear={onLogoClear} onSkip={() => send(tt('Pas de logo pour le moment', 'No logo for now'))} onDone={() => send(tt('Le logo est ajouté', 'The logo is added'))} />
                ) : m.choices.open || opened.has(i) ? (
                  <ChoicePicker choices={m.choices} onPick={name => send(name)} />
                ) : (
                  <button type="button" className="btn btn-ghost !min-h-[2.6rem] bg-white" onClick={() => setOpened(o => new Set(o).add(i))}>
                    <Icon name="chat" className="w-4 h-4" /> {t.see} {t.labels[m.choices.kind] || m.choices.label}
                  </button>
                )
              )}
            </div>
          ))}
          {busy && (
            <div className="flex justify-start" role="status" aria-label={tt('L’assistant écrit', 'The assistant is typing')}>
              <p className="flex gap-1.5 rounded-[18px] rounded-bl-[6px] border border-[var(--line)] bg-[var(--cream)] px-4 py-4">
                {[0, 1, 2].map(i => (
                  <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-[var(--taupe)]" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </p>
            </div>
          )}
          {done && !busy && revealing === -1 && (
            <div className="rounded-[14px] border border-[var(--line)] bg-white p-4 rise">
              <p className="font-semibold">{t.allDone}</p>
              <p className="mt-0.5 text-sm text-[var(--muted)]">{t.doneHelp}</p>
              <button type="button" className="btn btn-primary mt-3" onClick={onReview}>
                {t.recap} <Icon name="right" className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
        )}

        {!messages.length ? null : conversation ? (
          <div className="flex items-center gap-3 border-t border-[var(--line)] px-3 py-3 sm:gap-4 sm:px-6 sm:py-4" role="status" aria-live="polite">
            <button type="button" onClick={() => { if (speaking) interrupt() }} className="rounded-full" aria-label={tt('Interrompre', 'Interrupt')} title={tt('Clique pour interrompre', 'Click to interrupt')}>
              <Orb state={busy ? 'thinking' : speaking ? 'speaking' : 'listening'} getLevel={getLevel} />
            </button>
            <p className="min-w-0 flex-1 truncate text-[15px] text-[var(--muted)]">
              {input || (busy ? t.thinking : speaking ? t.talking : t.listening)}
              {speaking && heardRaw && <span className="ml-2 text-xs italic text-[var(--taupe)]">« {heardRaw.slice(-60)} »</span>}
            </p>
            <button type="button" className="btn btn-primary !min-h-[2.5rem] !px-4" onClick={toggleConversation}>{t.stop}</button>
          </div>
        ) : (
          <form className="border-t border-[var(--line)] px-3 py-3 sm:px-6 sm:py-3.5" onSubmit={e => { e.preventDefault(); send(input) }}>
            <div className="flex items-end gap-2">
              <textarea
                className="field min-h-[2.75rem] flex-1 resize-none text-[15px]"
                ref={inputRef}
                rows={1}
                value={input}
                placeholder={conversation ? (busy ? t.thinking : speaking ? t.talking : t.listening) : listening ? t.dictating : t.typing}
                aria-label={tt('Ton message', 'Your message')}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
              />
              {SpeechRecognitionApi && (
                <button type="button" onClick={toggleConversation} aria-pressed={conversation}
                  aria-label={tt('Démarrer la conversation vocale', 'Start the voice conversation')}
                  title={tt('Conversation vocale mains libres', 'Hands-free voice conversation')}
                  className={`btn !px-4 !min-h-[2.75rem] ${conversation ? 'btn-primary' : 'btn-ghost'}`}>
                  <Icon name="wave" className="w-5 h-5" /> <span className="hidden sm:inline">{conversation ? t.stop : t.conversation}</span>
                </button>
              )}
              {SpeechRecognitionApi && (
                <button type="button" onClick={toggleMic} aria-pressed={listening}
                  aria-label={listening ? tt('Arrêter la dictée', 'Stop dictation') : tt('Dicter', 'Dictate')}
                  className={`btn !px-0 w-[2.75rem] !min-h-[2.75rem] ${listening ? 'btn-primary animate-pulse' : 'btn-ghost'}`}>
                  <Icon name="mic" className="w-5 h-5" />
                </button>
              )}
              <button type="submit" className="btn btn-primary !px-0 w-[2.75rem] !min-h-[2.75rem]" disabled={!input.trim() || busy} aria-label={tt('Envoyer', 'Send')}>
                <Icon name="send" className="w-5 h-5" />
              </button>
            </div>
          </form>
        )}
      </section>

      <div>{summary}</div>
    </div>
  )
}


/** Clickable list shown under the assistant's question: search, scroll, one click to choose. */
function ChoicePicker({ choices, onPick }: { choices: Choices; onPick: (name: string) => void }) {
  const tt = useT()
  const label = TEXTS[useLang().lang].labels[choices.kind] || choices.label
  const [query, setQuery] = useState('')
  const normalise = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const shown = choices.options.filter(o => normalise(o).includes(normalise(query)))
  const icon = choices.kind === 'hotels' ? 'bed' : choices.kind === 'meals' ? 'utensils' : choices.kind === 'breakfasts' ? 'sun' : 'compass'
  return (
    <div className="w-full max-w-[34rem] rounded-[16px] border border-[var(--line)] bg-white p-3 shadow-sm rise">
      <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
        {label} · {choices.options.length}
      </p>
      {choices.options.length > 7 && (
        <input className="field mb-2 !min-h-[2.6rem]" value={query} placeholder={tt('Rechercher…', 'Search…')} aria-label={`${tt('Rechercher parmi les', 'Search among')} ${label}`}
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
        {shown.length === 0 && <li className="px-3 py-3 text-sm text-[var(--muted)]">{tt('Aucun résultat.', 'No result.')}</li>}
      </ul>
    </div>
  )
}


/** Drop zone for the client's logo, shown inside the conversation. */
function LogoPicker({ logoFile, onLogo, onClear, onSkip, onDone }: {
  logoFile: File | null; onLogo: (file: File | null) => void; onClear: () => void; onSkip: () => void; onDone: () => void
}) {
  const tt = useT()
  const [dragging, setDragging] = useState(false)
  return (
    <div className="w-full max-w-[34rem] rounded-[16px] border border-[var(--line)] bg-white p-4 shadow-sm rise">
      {logoFile ? (
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[#edf6f0] text-[var(--ok)]"><Icon name="check" className="w-5 h-5" strokeWidth={2.5} /></span>
          <div className="min-w-0 flex-1"><p className="truncate font-medium">{logoFile.name}</p><p className="text-xs text-[var(--muted)]">{tt('Logo ajouté', 'Logo added')}</p></div>
          <button type="button" className="icon-btn" onClick={onClear} aria-label={tt('Retirer le logo', 'Remove the logo')}><Icon name="x" className="w-4 h-4" /></button>
          <button type="button" className="btn btn-primary !min-h-[2.6rem]" onClick={onDone}>{tt('Continuer', 'Continue')}</button>
        </div>
      ) : (
        <>
          <label
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); onLogo(e.dataTransfer.files?.[0] || null) }}
            className={`flex cursor-pointer flex-col items-center gap-1 rounded-[12px] border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? 'border-[var(--burgundy)] bg-[var(--sand)]' : 'border-[var(--taupe)] hover:bg-[var(--sand)]'}`}>
            <Icon name="upload" className="w-6 h-6 text-[var(--muted)]" />
            <span>{tt('Glisse le logo ici ou', 'Drop the logo here or')} <span className="font-semibold text-[var(--burgundy)]">{tt('parcours', 'browse')}</span></span>
            <span className="text-xs text-[var(--muted)]">{tt('PNG, JPEG… il apparaîtra sur la page de garde', 'PNG, JPEG… it will appear on the cover page')}</span>
            <input type="file" accept="image/*" className="sr-only" onChange={e => onLogo(e.target.files?.[0] || null)} />
          </label>
          <button type="button" className="btn btn-quiet mt-2 !text-[var(--muted)]" onClick={onSkip}>{tt('Passer, pas de logo', 'Skip, no logo')}</button>
        </>
      )}
    </div>
  )
}


/** Writes a reply out little by little, like a person typing. `run` is false while a spoken reply waits for its first sound. */
function Typed({ text, run, cps, onDone }: { text: string; run: boolean; cps: number; onDone: () => void }) {
  const [n, setN] = useState(0)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    if (!run) return
    const step = Math.max(1, Math.round(cps / 30))
    const id = setInterval(() => setN(k => Math.min(text.length, k + step)), 33)
    return () => clearInterval(id)
  }, [run, text, cps])
  useEffect(() => { if (n >= text.length) done.current() }, [n, text])
  return <>{text.slice(0, n)}</>
}

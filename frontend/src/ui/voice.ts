/** The assistant's voice (Gemini, served by the backend) and the "talk over it" detector. */

import type { Lang } from './i18n'

const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='

/** Cuts a reply into short pieces so the first one starts playing while the rest is still being made. */
export function splitForSpeech(text: string, max = 170): string[] {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]*\s*/g) || []
  const chunks: string[] = []
  for (const s of sentences) {
    const last = chunks[chunks.length - 1]
    if (last && last.length + s.length <= max) chunks[chunks.length - 1] = last + s
    else chunks.push(s.trim())
  }
  return chunks.filter(Boolean)
}

export class Speaker {
  private el = new Audio()
  private token = 0
  constructor(private apiUrl: string, private password: string) {}

  /** Must run inside a click: Safari only lets a page play sound after a tap. */
  unlock() {
    this.el.src = SILENCE
    this.el.play().catch(() => {})
  }

  stop() {
    this.token++
    this.el.pause()
    window.speechSynthesis?.cancel()
  }

  private async fetchChunk(text: string): Promise<string> {
    const res = await fetch(`${this.apiUrl}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Password': this.password },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) throw new Error(`speak ${res.status}`)
    return URL.createObjectURL(await res.blob())
  }

  private play(url: string): Promise<void> {
    return new Promise(resolve => {
      this.el.onended = this.el.onerror = () => resolve()
      this.el.src = url
      this.el.play().catch(() => resolve())
    })
  }

  /** Reads the text out loud; resolves when finished or interrupted. Falls back to the browser voice if the server one fails. */
  async say(text: string, lang: Lang, onStart?: () => void): Promise<void> {
    const id = ++this.token
    this.el.pause()
    window.speechSynthesis?.cancel()
    const pieces = splitForSpeech(text)
    const urls = pieces.map(p => this.fetchChunk(p))
    urls.forEach(u => u.catch(() => {})) // handled below, in order
    try {
      for (let i = 0; i < urls.length; i++) {
        const url = await urls[i]
        if (id !== this.token) return
        if (i === 0) onStart?.()
        await this.play(url)
        URL.revokeObjectURL(url)
        if (id !== this.token) return
      }
    } catch {
      if (id !== this.token || !window.speechSynthesis) return
      await new Promise<void>(resolve => {
        const u = new SpeechSynthesisUtterance(text)
        u.lang = lang === 'en' ? 'en-US' : 'fr-FR'
        u.voice = window.speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(lang)) || null
        u.onend = u.onerror = () => resolve()
        onStart?.()
        window.speechSynthesis.speak(u)
      })
    }
  }
}

/** Keeps the micro open during a conversation and tells when the person starts talking (to cut the assistant off). */
export class VoiceDetector {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private timer: number | undefined
  private onVoice: (() => void) | null = null
  private armedAt = 0
  private loud = 0
  private floor = 0.01
  level = 0

  async open(): Promise<boolean> {
    if (this.stream) return true
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      this.ctx = new Ctx()
      await this.ctx.resume() // starts suspended until the page has had a tap
      const analyser = this.ctx.createAnalyser()
      analyser.fftSize = 1024
      this.ctx.createMediaStreamSource(this.stream).connect(analyser)
      const data = new Float32Array(analyser.fftSize)
      this.timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(data)
        const rms = Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length)
        this.level = rms
        // what the micro hears when nobody talks (room noise, a faint echo of the assistant): the voice must clearly exceed it
        const loud = rms > Math.max(0.02, this.floor * 3)
        if (!loud) this.floor = this.floor * 0.95 + rms * 0.05
        this.loud = loud && this.onVoice && Date.now() - this.armedAt > 350 ? this.loud + 1 : 0
        if (this.loud >= 3 && this.onVoice) { const cb = this.onVoice; this.onVoice = null; cb() } // ~150 ms of voice
      }, 50)
      return true
    } catch {
      this.close()
      return false
    }
  }

  /** From now on, call back once if someone talks. */
  arm(onVoice: () => void) { this.armedAt = Date.now(); this.loud = 0; this.onVoice = onVoice }
  disarm() { this.onVoice = null }

  close() {
    window.clearInterval(this.timer)
    this.onVoice = null
    this.stream?.getTracks().forEach(t => t.stop())
    this.ctx?.close().catch(() => {})
    this.stream = null
    this.ctx = null
  }
}

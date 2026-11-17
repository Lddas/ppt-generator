/** The assistant's voice (Gemini, served by the backend) and the "talk over it" detector. */


const RATE = 24000 // what the server streams: raw 16-bit mono PCM

/** The assistant's voice. The server streams the speech while Gemini makes it, and it is played as it arrives (first sound in ~1 s). */
export class Speaker {
  private ctx: AudioContext | null = null
  private sources: AudioBufferSourceNode[] = []
  private controller: AbortController | null = null
  private token = 0
  constructor(private apiUrl: string, private password: string) {}

  private context() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      this.ctx = new Ctx()
    }
    return this.ctx!
  }

  /** Must run inside a click: browsers only let a page play sound after a tap. */
  unlock() {
    this.context().resume().catch(() => {})
  }

  stop() {
    this.token++
    this.controller?.abort()
    this.sources.forEach(source => { try { source.stop() } catch { /* already finished */ } })
    this.sources = []
  }

  /** Reads the text out loud; resolves when finished or interrupted. If the server voice is down it stays silent: never a second voice. */
  async say(text: string, onStart?: () => void): Promise<'ok' | 'unavailable' | 'budget'> {
    this.stop()
    const id = this.token
    const ctx = this.context()
    await ctx.resume().catch(() => {})
    const controller = new AbortController()
    this.controller = controller
    let playAt = 0
    let started = false
    let leftover = new Uint8Array(0)
    let pending: Float32Array[] = []
    let pendingLength = 0

    const schedule = () => {
      if (!pendingLength) return
      const samples = new Float32Array(pendingLength)
      let offset = 0
      for (const piece of pending) { samples.set(piece, offset); offset += piece.length }
      pending = []; pendingLength = 0
      const buffer = ctx.createBuffer(1, samples.length, RATE)
      buffer.copyToChannel(samples, 0)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      if (!started) { started = true; playAt = ctx.currentTime + 0.08; onStart?.() }
      playAt = Math.max(playAt, ctx.currentTime + 0.01) // if the network is late, carry on right away
      source.start(playAt)
      playAt += buffer.duration
      this.sources.push(source)
    }

    try {
      const res = await fetch(`${this.apiUrl}/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-App-Password': this.password },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      })
      if (res.status === 402) return 'budget' // no more Gemini money
      if (!res.ok || !res.body) return 'unavailable'
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (id !== this.token) return 'ok'
        if (done) break
        const bytes = new Uint8Array(leftover.length + value.length)
        bytes.set(leftover); bytes.set(value, leftover.length)
        const usable = bytes.length - (bytes.length % 2)
        leftover = bytes.slice(usable)
        const view = new DataView(bytes.buffer, 0, usable)
        const samples = new Float32Array(usable / 2)
        for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768
        pending.push(samples); pendingLength += samples.length
        if (pendingLength >= RATE / 8) schedule() // about 125 ms per piece
      }
      schedule()
      // wait for the end of what was scheduled
      const deadline = Date.now() + Math.max(playAt - ctx.currentTime, 0) * 1000 + 3000 // a suspended audio clock must not hang the conversation
      while (id === this.token && ctx.currentTime < playAt && Date.now() < deadline) await new Promise(r => setTimeout(r, 60))
    } catch {
      if (!started && id === this.token) return 'unavailable' // network down; an interruption is not a failure
    }
    return 'ok'
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
        const loud = rms > Math.max(0.015, this.floor * 2)
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

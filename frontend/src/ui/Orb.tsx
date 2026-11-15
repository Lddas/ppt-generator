import React, { useEffect, useRef } from 'react'

/** The talking orb of the conversation mode: swirls while it thinks, swells with the voice (yours while it listens, its own while it speaks). */
export default function Orb({ state, getLevel }: { state: 'listening' | 'thinking' | 'speaking'; getLevel: () => number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let frame = 0
    const start = performance.now()
    const loop = () => {
      const t = (performance.now() - start) / 1000
      let amp: number
      if (state === 'listening') amp = Math.min(getLevel() * 7, 1) * 0.6 + 0.04 * Math.sin(t * 2)
      else if (state === 'speaking') amp = 0.28 + 0.22 * Math.abs(Math.sin(t * 5.3)) * Math.abs(Math.sin(t * 2.1 + 1))
      else amp = 0.1 + 0.08 * Math.sin(t * 2.4)
      ref.current?.style.setProperty('--amp', amp.toFixed(3))
      frame = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(frame)
  }, [state, getLevel])
  return <div ref={ref} className="orb" data-state={state} aria-hidden="true"><span /><span /><span /></div>
}

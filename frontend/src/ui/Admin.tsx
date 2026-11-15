import React, { useEffect, useState } from 'react'
import Icon from './Icon'
import { useT } from './i18n'

const KEY = 'pref-ppt-admin'
type Row = { date: string; cost: number; text?: number; voice?: number; calls: number }
type Stats = {
  days: Row[]; months: Row[]; today: number; month: number
  total: { cost: number; text: number; voice: number; calls: number }
  config: { model: string; voice: string; eurRate: number; prices: Record<string, { in: number; out: number }> }
  models: string[]; voices: string[]; persistent: boolean
}

const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`

/** The admin page: what the assistant costs (per day / month) and the model and voice it uses. */
export default function Admin({ apiUrl, onBack }: { apiUrl: string; onBack: () => void }) {
  const t = useT()
  const [code, setCode] = useState(() => { try { return sessionStorage.getItem(KEY) || '' } catch { return '' } })
  const [typed, setTyped] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [view, setView] = useState<'day' | 'month'>('day')
  const [model, setModel] = useState('')
  const [voice, setVoice] = useState('')
  const [rate, setRate] = useState('0.92')
  const [prices, setPrices] = useState<Record<string, { in: string; out: string }>>({})

  async function call(path: string, adminCode: string, body?: object): Promise<Stats> {
    const res = await fetch(`${apiUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Admin-Code': adminCode, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      let detail = `${t('Erreur', 'Error')} ${res.status}`
      try { detail = (await res.json()).detail || detail } catch { /* not JSON */ }
      const failure: any = new Error(detail); failure.status = res.status
      throw failure
    }
    return res.json()
  }

  function show(data: Stats) {
    setStats(data)
    setModel(data.config.model || data.models[0])
    setVoice(data.config.voice || data.voices[0])
    setRate(String(data.config.eurRate))
    setPrices(Object.fromEntries(Object.entries(data.config.prices).map(([m, p]) => [m, { in: String(p.in), out: String(p.out) }])))
  }

  async function load(adminCode: string) {
    setBusy(true); setError('')
    try {
      show(await call('/admin/stats', adminCode))
      try { sessionStorage.setItem(KEY, adminCode) } catch { /* private mode */ }
      setCode(adminCode)
    } catch (e: any) {
      if (e.status === 401 || e.status === 503) { try { sessionStorage.removeItem(KEY) } catch { /* ignore */ } setCode('') }
      setError(e.message === 'Failed to fetch' ? t('Le serveur ne répond pas.', 'The server is not answering.') : e.message)
    } finally { setBusy(false) }
  }

  useEffect(() => { if (code) load(code) }, [])

  async function save() {
    setBusy(true); setError(''); setSaved(false)
    try {
      show(await call('/admin/config', code, {
        model, voice, eurRate: Number(rate),
        prices: Object.fromEntries(Object.entries(prices).map(([m, p]) => [m, { in: Number(p.in), out: Number(p.out) }])),
      }))
      setSaved(true)
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto max-w-[1000px] px-5 py-8 rise">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">{t('Administration', 'Administration')}</h1>
        <button type="button" className="btn btn-quiet" onClick={onBack}><Icon name="left" className="w-4 h-4" /> {t('Retour', 'Back')}</button>
      </div>
      {children}
    </div>
  )

  if (!code || !stats) {
    return shell(
      <form className="card mx-auto max-w-sm p-6" onSubmit={e => { e.preventDefault(); load(typed) }}>
        <label className="label" htmlFor="admin-code">{t('Code admin', 'Admin code')}</label>
        <input id="admin-code" type="password" autoFocus className="field" value={typed} onChange={e => { setTyped(e.target.value); setError('') }} />
        {error && <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
        <button type="submit" className="btn btn-primary mt-4 w-full" disabled={!typed || busy}>{busy ? '…' : t('Entrer', 'Enter')}</button>
      </form>
    )
  }

  const eur = (n: number) => `≈ ${(n * stats.config.eurRate).toFixed(n * stats.config.eurRate < 1 ? 3 : 2)} €`
  const rows = (view === 'day' ? stats.days.slice(-30) : stats.months) as Row[]
  const max = Math.max(...rows.map(r => r.cost), 0.0001)
  const barWidth = 100 / Math.max(rows.length, 1)

  return shell(
    <div className="space-y-5">
      {!stats.persistent && (
        <div role="alert" className="rounded-[12px] border border-[#e8c3be] bg-[#fbeceb] p-4 text-sm text-[var(--danger)]">
          {t('Les données ne sont pas conservées : elles sont effacées à chaque déploiement ou redémarrage. Ajoute un Disk sur Render (point de montage /data) pour les garder.',
             'Data is not kept: it is wiped on every deploy or restart. Add a Disk on Render (mount path /data) to keep it.')}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [t('Aujourd’hui', 'Today'), stats.today], [t('Ce mois-ci', 'This month'), stats.month], [t('Total', 'Total'), stats.total.cost],
        ].map(([label, value]) => (
          <div key={label as string} className="card px-4 py-4">
            <div className="text-xs text-[var(--muted)]">{label}</div>
            <div className="font-display text-2xl font-semibold text-[var(--burgundy)]">{usd(value as number)}</div>
            <div className="text-xs text-[var(--muted)]">{eur(value as number)}</div>
          </div>
        ))}
        <div className="card px-4 py-4">
          <div className="text-xs text-[var(--muted)]">{t('Appels', 'Calls')}</div>
          <div className="font-display text-2xl font-semibold">{stats.total.calls}</div>
          <div className="text-xs text-[var(--muted)]">{t('texte', 'text')} {usd(stats.total.text)} · {t('voix', 'voice')} {usd(stats.total.voice)}</div>
        </div>
      </div>

      <section className="card p-5" aria-label={t('Coûts', 'Costs')}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="label !mb-0">{t('Coûts', 'Costs')}</h2>
          <div className="flex overflow-hidden rounded-[10px] border border-[var(--line)] text-sm font-semibold" role="group">
            {(['day', 'month'] as const).map(v => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                className={`px-3 py-1.5 ${view === v ? 'bg-[var(--burgundy)] text-white' : 'bg-white text-[var(--muted)]'}`}>
                {v === 'day' ? t('Par jour', 'By day') : t('Par mois', 'By month')}
              </button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="py-10 text-center text-[var(--muted)]">{t('Aucune utilisation enregistrée pour le moment.', 'No usage recorded yet.')}</p>
        ) : (
          <>
            <svg viewBox="0 0 100 44" className="h-56 w-full" preserveAspectRatio="none" role="img"
              aria-label={t('Graphique des coûts', 'Cost chart')}>
              {[0.25, 0.5, 0.75, 1].map(f => <line key={f} x1="0" x2="100" y1={40 - f * 38} y2={40 - f * 38} stroke="var(--line)" strokeWidth="0.2" />)}
              {rows.map((r, i) => {
                const voiceH = ((r.voice || 0) / max) * 38
                const textH = ((r.text || 0) / max) * 38
                const x = i * barWidth + barWidth * 0.15
                return (
                  <g key={r.date}>
                    <title>{`${r.date} · ${usd(r.cost)} (${t('texte', 'text')} ${usd(r.text || 0)}, ${t('voix', 'voice')} ${usd(r.voice || 0)}) · ${r.calls} ${t('appels', 'calls')}`}</title>
                    <rect x={x} y={40 - textH} width={barWidth * 0.7} height={textH} fill="var(--burgundy)" />
                    <rect x={x} y={40 - textH - voiceH} width={barWidth * 0.7} height={voiceH} fill="#d9a441" />
                  </g>
                )
              })}
            </svg>
            <div className="mt-1 flex justify-between text-xs text-[var(--muted)]">
              <span>{rows[0].date}</span><span>{t('max', 'max')} {usd(max)}</span><span>{rows[rows.length - 1].date}</span>
            </div>
            <div className="mt-3 flex gap-4 text-xs text-[var(--muted)]">
              <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--burgundy)]" /> {t('Texte (assistant)', 'Text (assistant)')}</span>
              <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#d9a441' }} /> {t('Voix', 'Voice')}</span>
            </div>
          </>
        )}
      </section>

      <section className="card p-5" aria-label={t('Réglages', 'Settings')}>
        <h2 className="label">{t('Réglages', 'Settings')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="adm-model">{t('Modèle de l’assistant', 'Assistant model')}</label>
            <select id="adm-model" className="select" value={model} onChange={e => setModel(e.target.value)}>
              {stats.models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <p className="mt-1.5 text-xs text-[var(--muted)]">{t('Les autres modèles prennent le relais automatiquement s’il est saturé.', 'The other models take over automatically if it is overloaded.')}</p>
          </div>
          <div>
            <label className="label" htmlFor="adm-voice">{t('Voix', 'Voice')}</label>
            <select id="adm-voice" className="select" value={voice} onChange={e => setVoice(e.target.value)}>
              {stats.voices.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>

        <details className="mt-5">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--burgundy)]">{t('Tarifs utilisés pour le calcul ($ par million de tokens)', 'Prices used for the calculation ($ per million tokens)')}</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-[var(--muted)]"><th className="py-1">{t('Modèle', 'Model')}</th><th>{t('Entrée', 'Input')}</th><th>{t('Sortie / audio', 'Output / audio')}</th></tr></thead>
              <tbody>
                {Object.entries(prices).map(([m, p]) => (
                  <tr key={m}>
                    <td className="py-1 pr-3">{m}</td>
                    {(['in', 'out'] as const).map(k => (
                      <td key={k} className="pr-2"><input className="field !min-h-[2.2rem] !py-1" inputMode="decimal" value={p[k]} aria-label={`${m} ${k}`}
                        onChange={e => setPrices(all => ({ ...all, [m]: { ...all[m], [k]: e.target.value } }))} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <label htmlFor="adm-rate">{t('1 $ en €', '$1 in €')}</label>
              <input id="adm-rate" className="field !min-h-[2.2rem] !w-24 !py-1" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} />
            </div>
          </div>
        </details>

        {error && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
        <div className="mt-5 flex items-center gap-3">
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{t('Enregistrer', 'Save')}</button>
          {saved && <span className="flex items-center gap-1 text-sm text-[var(--ok)]"><Icon name="check" className="w-4 h-4" strokeWidth={2.5} /> {t('Enregistré', 'Saved')}</span>}
        </div>
      </section>
    </div>
  )
}

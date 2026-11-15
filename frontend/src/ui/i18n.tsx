import React, { createContext, useContext } from 'react'
import Icon from './Icon'

export type Lang = 'fr' | 'en'
const KEY = 'pref-ppt-lang'

export const readLang = (): Lang => { try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'fr' } catch { return 'fr' } }
export const saveLang = (lang: Lang) => { try { localStorage.setItem(KEY, lang) } catch { /* private mode */ } }

export const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'fr', setLang: () => {} })
export const useLang = () => useContext(LangContext)

/** t('texte français', 'English text') */
export function useT() {
  const { lang } = useLang()
  return (fr: string, en: string) => (lang === 'en' ? en : fr)
}

/** Same thing outside of components (error messages). */
export const tNow = (fr: string, en: string) => (readLang() === 'en' ? en : fr)

/** The little globe: switches the whole site between French and English. */
export function LangButton({ className = '' }: { className?: string }) {
  const { lang, setLang } = useLang()
  return (
    <button type="button" className={`btn btn-quiet !px-2.5 ${className}`}
      onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
      aria-label={lang === 'fr' ? 'Switch to English' : 'Passer en français'}
      title={lang === 'fr' ? 'English' : 'Français'}>
      <Icon name="globe" className="w-4 h-4" /><span className="text-xs font-semibold uppercase">{lang === 'fr' ? 'en' : 'fr'}</span>
    </button>
  )
}

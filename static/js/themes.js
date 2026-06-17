const DEFAULT_BOOT = {
  ids: ['dark', 'dark-midnight', 'dark-forest', 'light', 'light-warm', 'light-frost'],
  meta: {
    dark: '#0c1220',
    'dark-midnight': '#0a0614',
    'dark-forest': '#050d0a',
    light: '#e8ecf4',
    'light-warm': '#ebe4d8',
    'light-frost': '#eef8ff',
  },
}

function parseThemeBootstrap() {
  const el = document.getElementById('nebula-theme-bootstrap')
  if (!el) return DEFAULT_BOOT
  try {
    const p = JSON.parse(el.textContent)
    if (Array.isArray(p.ids) && p.meta && typeof p.meta === 'object') {
      return { ids: p.ids, meta: p.meta }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_BOOT
}

const _boot = parseThemeBootstrap()

/** Valid theme ids (from #nebula-theme-bootstrap, same as inline FOUC script). */
const THEME_IDS = _boot.ids

/** Meta theme-color values for status bar / PWA */
export const THEME_META_COLOR = _boot.meta

export function readStoredTheme() {
  const raw = localStorage.getItem('theme') || 'dark'
  return normalizeTheme(raw)
}

export function normalizeTheme(raw) {
  if (THEME_IDS.includes(raw)) return raw
  return 'dark'
}

export function isLightTheme(id) {
  return id.startsWith('light')
}

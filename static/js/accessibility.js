/**
 * Режим для слабовидящих: крупнее текст, выше контраст, чёткий фокус.
 * Класс `low-vision` вешается на <html> (а не <body>), чтобы переключение темы,
 * которое перезаписывает body.className, не сбрасывало его. Применение на старте —
 * в inline-скрипте index.html (без мигания). Здесь — рантайм-переключение.
 */
import { t } from './i18n.js'

const LV_KEY = 'lowVision'

export function isLowVision() {
  try {
    return localStorage.getItem(LV_KEY) === '1'
  } catch {
    return false
  }
}

export function applyLowVision(on) {
  document.documentElement.classList.toggle('low-vision', on)
  try {
    localStorage.setItem(LV_KEY, on ? '1' : '0')
  } catch {
    /* localStorage может быть недоступен */
  }
  syncLowVisionControls()
}

export function toggleLowVision() {
  applyLowVision(!isLowVision())
}

/** Синхронизирует состояние всех кнопок-переключателей (настройки + экран входа). */
export function syncLowVisionControls() {
  const on = isLowVision()
  document.querySelectorAll('[data-lowvision-toggle]').forEach((btn) => {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    btn.classList.toggle('is-active', on)
    btn.classList.toggle('active', on)
    const stateEl = btn.querySelector('.accessibility-toggle-state')
    if (stateEl) {
      const key = on ? 'lowVisionOn' : 'lowVisionOff'
      stateEl.setAttribute('data-i18n', key)
      stateEl.textContent = t(key)
    }
  })
}

export function bindLowVisionControls() {
  syncLowVisionControls()
  document.querySelectorAll('[data-lowvision-toggle]').forEach((btn) => {
    if (btn.dataset.lvBound === '1') return
    btn.dataset.lvBound = '1'
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleLowVision()
    })
  })
}

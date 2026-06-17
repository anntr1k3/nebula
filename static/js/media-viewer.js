import { t } from './i18n.js'

let root
let stage
let _bound

/**
 * Полноэкранный просмотр изображения или видео (lightbox).
 * Закрытие: кнопка, клик по фону, Escape (см. app.js).
 */
export function openMediaViewer({ kind, src }) {
  if (!root || !stage || !src) return
  stage.innerHTML = ''
  if (kind === 'image') {
    const img = document.createElement('img')
    img.src = src
    img.alt = ''
    img.className = 'media-viewer__img'
    img.decoding = 'async'
    stage.appendChild(img)
  } else {
    const v = document.createElement('video')
    v.className = 'media-viewer__video'
    v.src = src
    v.controls = true
    v.playsInline = true
    stage.appendChild(v)
    v.play().catch(() => {})
  }
  root.hidden = false
  document.body.classList.add('media-viewer-open')
}

export function closeMediaViewer() {
  if (!root || root.hidden) return
  const v = stage?.querySelector('video')
  if (v) {
    try {
      v.pause()
    } catch {
      /* ignore */
    }
  }
  stage.innerHTML = ''
  root.hidden = true
  document.body.classList.remove('media-viewer-open')
}

export function isMediaViewerOpen() {
  return !!(root && !root.hidden)
}

export function initMediaViewer(els) {
  if (_bound) return
  root = els.mediaViewer
  if (!root) return
  stage = root.querySelector('.media-viewer__stage')
  if (!stage) return
  const closeBtn = root.querySelector('.media-viewer__close')
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      closeMediaViewer()
    })
  }
  root.addEventListener('click', (e) => {
    if (e.target === root) closeMediaViewer()
  })
  _bound = true
}

export function applyMediaViewerI18n() {
  const el = document.getElementById('media-viewer')
  if (!el) return
  el.setAttribute('aria-label', t('mediaViewerDialog'))
  const c = el.querySelector('.media-viewer__close')
  if (c) c.setAttribute('aria-label', t('closeButton'))
}

/** Плавное появление выпадающих панелей в сайдбаре (подсказки, поиск). */
export const SIDEBAR_DROPDOWN_OPEN_CLASS = 'sidebar-dropdown--enter'

/** Синхронно с `--duration-modal` в `_tokens.css` + запас на transitionend. */
const SIDEBAR_DROPDOWN_MS = 260

export function getSidebarDropdownBody(el) {
  return el?.querySelector(':scope > .sidebar-dropdown__body') ?? el
}

function clearSidebarDropdownBody(el) {
  const body = getSidebarDropdownBody(el)
  if (body) body.innerHTML = ''
}

export function revealSidebarDropdown(el) {
  if (!el) return
  const opening = el.hidden
  el.hidden = false
  if (!opening) return
  el.classList.remove(SIDEBAR_DROPDOWN_OPEN_CLASS)
  void el.offsetWidth
  el.classList.add(SIDEBAR_DROPDOWN_OPEN_CLASS)
}

export function hideSidebarDropdown(el, { clear = false } = {}) {
  if (!el || el.hidden) return
  const finish = () => {
    el.hidden = true
    if (clear) clearSidebarDropdownBody(el)
  }
  if (!el.classList.contains(SIDEBAR_DROPDOWN_OPEN_CLASS)) {
    finish()
    return
  }
  el.classList.remove(SIDEBAR_DROPDOWN_OPEN_CLASS)
  let done = false
  const onEnd = (e) => {
    if (done || e.target !== el || e.propertyName !== 'grid-template-rows') return
    done = true
    el.removeEventListener('transitionend', onEnd)
    finish()
  }
  el.addEventListener('transitionend', onEnd)
  window.setTimeout(() => {
    if (done) return
    done = true
    el.removeEventListener('transitionend', onEnd)
    finish()
  }, SIDEBAR_DROPDOWN_MS)
}

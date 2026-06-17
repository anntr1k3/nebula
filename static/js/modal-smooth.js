const SMOOTH_MODAL_CLOSE_MS = 360

export function openSmoothModal(el) {
  el.hidden = false
  el.classList.remove('modal--smooth-open', 'modal--smooth-closing')
  void el.offsetWidth
  requestAnimationFrame(() => {
    void el.offsetWidth
    requestAnimationFrame(() => {
      el.classList.add('modal--smooth-open')
    })
  })
}

export function closeSmoothModal(el) {
  if (el.hidden) return
  if (!el.classList.contains('modal--smooth-open')) {
    el.hidden = true
    el.classList.remove('modal--smooth-closing')
    return
  }
  el.classList.add('modal--smooth-closing')
  el.classList.remove('modal--smooth-open')
  let finished = false
  const done = () => {
    if (finished) return
    finished = true
    el.hidden = true
    el.classList.remove('modal--smooth-closing')
    el.removeEventListener('transitionend', onEnd)
    clearTimeout(fallback)
  }
  const onEnd = (e) => {
    if (e.target !== el || e.propertyName !== 'opacity') return
    done()
  }
  el.addEventListener('transitionend', onEnd)
  const fallback = setTimeout(done, SMOOTH_MODAL_CLOSE_MS + 120)
}

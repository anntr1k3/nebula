/**
 * Анимации сообщений: появление, удаление с keyframes-leave, подсветка при
 * прокрутке к сообщению, принудительное истечение TTL-сообщений.
 *
 * Импорт `renderMessages` ленивый через ES-модуль: на момент вычисления
 * самих функций значения не читаются, только при вызовах — поэтому
 * возможная кольцевая зависимость с `messages-render.js` не ломает загрузку.
 */

import { els, state } from '../app-shell.js'
import { HIGHLIGHT_ANIM_MS, MSG_LEAVE_ANIM_MS } from './constants.js'
import { renderMessages } from './messages-render.js'

let expiryWatcherTimer = null

/** Запускает интервал TTL только пока в чате есть сообщения с expires_at. */
export function syncExpiryWatcher() {
  const needs = state.messages.some((m) => m.expires_at)
  if (needs) {
    if (!expiryWatcherTimer) {
      expiryWatcherTimer = setInterval(() => {
        pruneExpiredMessages()
        if (!state.messages.some((m) => m.expires_at)) syncExpiryWatcher()
      }, 1000)
    }
    return
  }
  if (expiryWatcherTimer) {
    clearInterval(expiryWatcherTimer)
    expiryWatcherTimer = null
  }
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function scheduleFrame2(fn) {
  if (typeof requestAnimationFrame !== 'function') {
    setTimeout(fn, 0)
    return
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(fn)
  })
}

/** Удаление сообщений из списка с короткой анимацией (удаление, TTL). */
export function animateMessagesLeaveAndRemove(messageIds) {
  const idSet = new Set(messageIds.map(String))
  if (!idSet.size || !els.messagesContainer) {
    state.messages = state.messages.filter((m) => !idSet.has(String(m.message_id)))
    renderMessages()
    return
  }
  const hadAny = state.messages.some((m) => idSet.has(String(m.message_id)))
  if (!hadAny) return

  if (prefersReducedMotion()) {
    state.messages = state.messages.filter((m) => !idSet.has(String(m.message_id)))
    renderMessages()
    return
  }

  const nodes = []
  for (const id of idSet) {
    const el = els.messagesContainer.querySelector(`[data-message-id="${CSS.escape(id)}"]`)
    if (el && !el.classList.contains('message--leaving')) {
      nodes.push(el)
    }
  }

  const commit = () => {
    state.messages = state.messages.filter((m) => !idSet.has(String(m.message_id)))
    renderMessages()
    syncExpiryWatcher()
  }

  if (!nodes.length) {
    commit()
    return
  }

  let done = false
  const listeners = new Map()
  const finalize = () => {
    if (done) return
    done = true
    window.clearTimeout(fallbackTimer)
    for (const [node, handler] of listeners) {
      node.removeEventListener('animationend', handler)
      /** Убираем «уходящий» узел сразу — иначе он остаётся в DOM после keyframes `forwards`. */
      node.remove()
    }
    listeners.clear()
    commit()
  }

  let remaining = nodes.length
  for (const node of nodes) {
    const onAnimEnd = (ev) => {
      if (done) return
      if (ev.target !== node) return
      const name = String(ev.animationName || '')
      if (name && !name.includes('nebula-msg-leave')) return
      remaining = Math.max(0, remaining - 1)
      if (remaining <= 0) finalize()
    }
    listeners.set(node, onAnimEnd)
  }
  const fallbackTimer = window.setTimeout(finalize, MSG_LEAVE_ANIM_MS)
  /**
   * Отложенный старт, как у появления: иначе первый keyframe кадр не попадает в paint.
   */
  scheduleFrame2(() => {
    if (done) return
    for (const node of nodes) {
      if (!node.isConnected) {
        remaining = Math.max(0, remaining - 1)
        if (remaining <= 0) finalize()
        continue
      }
      node.classList.add('message--leaving')
      const h = listeners.get(node)
      if (h) node.addEventListener('animationend', h)
    }
  })
}

/** Прокрутка только внутри ленты сообщений (без сдвига всей панели чата). */
function scrollMessageNodeIntoView(node) {
  const scroller = els.messagesContainer
  if (!scroller || !node) return
  const scrollerRect = scroller.getBoundingClientRect()
  const nodeRect = node.getBoundingClientRect()
  const relativeTop = nodeRect.top - scrollerRect.top + scroller.scrollTop
  const target = relativeTop - (scroller.clientHeight - nodeRect.height) / 2
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  scroller.scrollTo({
    top: Math.max(0, Math.min(target, maxScroll)),
    behavior: 'smooth',
  })
}

/** Прокрутка к сообщению по id и короткая подсветка. */
export function scrollToMessageById(messageId) {
  if (!messageId || !els.messagesContainer) return
  const node = els.messagesContainer.querySelector(
    `[data-message-id="${CSS.escape(String(messageId))}"]`,
  )
  if (!node) return
  scrollMessageNodeIntoView(node)
  node.classList.remove('message--highlight')
  void node.offsetWidth
  node.classList.add('message--highlight')
  /** Синхронно с `--duration-highlight` (1.3s) + 100ms запас. */
  setTimeout(() => node.classList.remove('message--highlight'), HIGHLIGHT_ANIM_MS)
}

export function pruneExpiredMessages() {
  if (!state.currentRoom || !state.messages.length) return
  if (!state.messages.some((m) => m.expires_at)) return
  const now = Date.now()
  const expiredIds = state.messages
    .filter((m) => {
      if (!m.expires_at) return false
      const t = Date.parse(m.expires_at)
      return !Number.isNaN(t) && t <= now
    })
    .map((m) => String(m.message_id))
  if (!expiredIds.length) return
  animateMessagesLeaveAndRemove(expiredIds)
}

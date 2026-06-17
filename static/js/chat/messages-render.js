/**
 * Рендер сообщений чата: построение DOM-узла одного сообщения, сборка списка
 * с сохранением анимирующихся узлов, индикатор прочтения, реакции, формат времени,
 * отметка просмотренных пользователем сообщений.
 */

import { getUsername } from '../auth.js'
import { t } from '../i18n.js'
import { getSocket } from '../socket.js'
import { els, state } from '../app-shell.js'
import { privatePeer } from '../message-model.js'
import { createAppleEmojiImg, fillElementWithAppleEmoji } from '../emoji-apple.js'
import {
  onMsgTouchEnd,
  onMsgTouchStart,
  openMessageContext,
  toggleReaction,
} from './context-menu.js'
import { updateReplyPreview } from './composer.js'
import { formatScheduledBadge } from './scheduled-messages.js'
import { openMediaViewer } from '../media-viewer.js'

export function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function readReceiptMarkup(msg, roomId) {
  const me = getUsername()
  if (msg.username !== me) return ''
  const readers = msg.read_by || []
  const tick = (read) =>
    read
      ? '<i class="fa-solid fa-check-double" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-check" aria-hidden="true"></i>'
  if (roomId.startsWith('private_')) {
    const peer = privatePeer(roomId, me)
    const read = peer && readers.includes(peer)
    const cls = read ? 'message-ticks read' : 'message-ticks'
    const label = read ? t('readReceiptRead') : t('readReceiptSent')
    return `<span class="${cls}" title="${label}">${tick(read)}</span>`
  }
  const others = readers.filter((u) => u !== me)
  const read = others.length > 0
  const cls = read ? 'message-ticks read' : 'message-ticks'
  return `<span class="${cls}">${tick(read)}</span>`
}

function renderReactionChips(msg) {
  const reactions = msg.reactions || {}
  const entries = Object.entries(reactions)
  if (!entries.length) return null
  const wrap = document.createElement('div')
  wrap.className = 'message-reactions'
  entries.forEach(([emoji, users]) => {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'reaction-chip'
    const img = createAppleEmojiImg(emoji, 'reaction-chip-emoji')
    const count = document.createElement('span')
    count.className = 'reaction-chip-count'
    count.textContent = String(users?.length || 0)
    chip.appendChild(img)
    chip.appendChild(count)
    chip.addEventListener('click', () => toggleReaction(msg.message_id, emoji))
    wrap.appendChild(chip)
  })
  return wrap
}

const SCROLL_STICKY_PX = 140

function messageDomFingerprint(msg) {
  const reactions = msg.reactions || {}
  const keys = Object.keys(reactions).sort()
  const reactionSig = keys.map((k) => `${k}:${(reactions[k] || []).length}`).join(',')
  return [
    msg.text || '',
    msg.edited ? '1' : '0',
    msg.is_scheduled ? '1' : '0',
    msg.scheduled_at || '',
    msg.timestamp || '',
    reactionSig,
    (msg.read_by || []).join(','),
    msg.media?.type || '',
    msg.media?.data || '',
  ].join('|')
}

function isNearChatBottom(container) {
  if (!container) return true
  const gap = container.scrollHeight - container.scrollTop - container.clientHeight
  return gap < SCROLL_STICKY_PX
}

function getDisplayMessages() {
  return [...state.messages].sort((a, b) => {
    const ta = Date.parse(a.timestamp) || 0
    const tb = Date.parse(b.timestamp) || 0
    return ta - tb
  })
}

function findMessageEl(messageId) {
  const container = els.messagesContainer
  if (!container || messageId == null) return null
  const id = String(messageId)
  if (!id) return null
  return container.querySelector(`.message[data-message-id="${CSS.escape(id)}"]`)
}

/** Обновляет блок реакций без полного renderMessages. */
export function patchMessageReactions(msg) {
  if (!msg || msg.is_scheduled) return false
  const el = findMessageEl(msg.message_id)
  if (!el) return false

  const chips = renderReactionChips(msg)
  const footer = el.querySelector('.message-footer')
  let time = el.querySelector(':scope > .message-time')
  if (!time && footer) time = footer.querySelector('.message-time')
  if (!time) return false

  footer?.querySelector('.message-reactions')?.remove()

  if (chips) {
    if (footer) {
      footer.insertBefore(chips, footer.firstChild)
    } else {
      const newFooter = document.createElement('div')
      newFooter.className = 'message-footer'
      el.removeChild(time)
      newFooter.appendChild(chips)
      newFooter.appendChild(time)
      el.appendChild(newFooter)
    }
    return true
  }

  if (footer) {
    footer.replaceWith(time)
  }
  return true
}

/** Обновляет галочки прочтения в подвале сообщения. */
export function patchMessageReadReceipt(msg) {
  if (!msg || msg.is_scheduled) return false
  const el = findMessageEl(msg.message_id)
  if (!el) return false
  const time = el.querySelector('.message-time')
  if (!time) return false
  time.querySelectorAll('.message-ticks').forEach((n) => n.remove())
  const markup = readReceiptMarkup(msg, state.currentRoom || '')
  if (markup) time.insertAdjacentHTML('beforeend', markup)
  return true
}

/** Обновляет текст и метку «изменено». */
export function patchMessageEdited(msg) {
  if (!msg) return false
  const el = findMessageEl(msg.message_id)
  if (!el) return false

  const textEl = el.querySelector('.message-text')
  if (textEl && msg.text != null) {
    fillElementWithAppleEmoji(textEl, msg.text)
  }

  const time = el.querySelector('.message-time')
  if (time && msg.edited && !time.querySelector('.message-edited')) {
    const ed = document.createElement('span')
    ed.className = 'message-edited'
    ed.textContent = ` · ${t('messageEdited')}`
    const ticks = time.querySelector('.message-ticks')
    if (ticks) time.insertBefore(ed, ticks)
    else time.appendChild(ed)
  }
  return Boolean(textEl || time)
}

function buildMessageElement(msg, buildOpts = {}) {
  const { playEnter = false } = buildOpts
  const uname = getUsername()
  const div = document.createElement('div')
  div.className = 'message'
  div.dataset.messageId = msg.message_id
  if (msg.is_scheduled) div.classList.add('message--scheduled')
  if (msg.username === uname) div.classList.add('own')

  if (msg.is_scheduled) {
    const badge = document.createElement('div')
    badge.className = 'message-scheduled-badge'
    badge.innerHTML = `<i class="fa-solid fa-clock" aria-hidden="true"></i> ${formatScheduledBadge(msg.scheduled_at)}`
    div.appendChild(badge)
  }

  if (msg.replyTo) {
    const ref = document.createElement('div')
    ref.className = 'message-reply-ref'
    fillElementWithAppleEmoji(
      ref,
      `${msg.replyTo.username}: ${(msg.replyTo.text || '').slice(0, 200)}`,
    )
    div.appendChild(ref)
  }

  if (msg.username !== uname || state.currentChatType === 'group') {
    const u = document.createElement('span')
    u.className = 'message-username'
    u.textContent = msg.username
    div.appendChild(u)
  }

  if (msg.media) {
    const mt = msg.media.type
    const data = msg.media.data
    const box = document.createElement('div')
    box.className = 'message-media'
    if (mt === 'image' || mt === 'gif' || mt === 'sticker') {
      const src = data && data.startsWith('data:') ? data : data || ''
      const img = document.createElement('img')
      img.src = src
      img.alt = ''
      img.draggable = false
      if (src) {
        const wrap = document.createElement('button')
        wrap.type = 'button'
        wrap.className = 'message-media-link'
        wrap.title = t('viewInMediaViewer')
        wrap.setAttribute('aria-label', t('viewInMediaViewer'))
        wrap.appendChild(img)
        wrap.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          openMediaViewer({ kind: 'image', src })
        })
        wrap.addEventListener('auxclick', (e) => {
          if (e.button === 1) e.preventDefault()
        })
        box.appendChild(wrap)
      } else {
        box.appendChild(img)
      }
    } else if (mt === 'video') {
      const raw = data && data.startsWith('data:') ? data : data || ''
      const v = document.createElement('video')
      v.src = raw
      v.controls = true
      box.classList.add('message-media--has-video')
      const openV = (e) => {
        e.stopPropagation()
        if (raw) openMediaViewer({ kind: 'video', src: raw })
      }
      const expand = document.createElement('button')
      expand.type = 'button'
      expand.className = 'message-media-open-viewer'
      expand.title = t('openVideoInViewer')
      expand.setAttribute('aria-label', t('openVideoInViewer'))
      expand.innerHTML = '<i class="fa-solid fa-expand" aria-hidden="true"></i>'
      expand.addEventListener('click', openV)
      v.addEventListener('dblclick', (e) => {
        e.preventDefault()
        openV(e)
      })
      box.appendChild(v)
      box.appendChild(expand)
    } else if (mt === 'audio' || mt === 'voice') {
      box.classList.add('message-media--voice')
      const wrap = document.createElement('div')
      wrap.className = 'voice-wrap'
      const a = document.createElement('audio')
      a.controls = true
      a.preload = 'metadata'
      a.src = data && data.startsWith('data:') ? data : data || ''
      wrap.appendChild(a)
      const speeds = [1, 1.5, 2]
      const bar = document.createElement('div')
      bar.className = 'voice-speed-bar'
      speeds.forEach((sp) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'voice-speed-btn'
        if (sp === 1) b.classList.add('is-active')
        b.textContent = `${sp}x`
        b.addEventListener('click', () => {
          bar.querySelectorAll('.voice-speed-btn').forEach((btn) => {
            btn.classList.remove('is-active')
          })
          b.classList.add('is-active')
          a.playbackRate = sp
        })
        bar.appendChild(b)
      })
      wrap.appendChild(bar)
      box.appendChild(wrap)
    } else {
      const f = document.createElement('a')
      f.className = 'message-file'
      f.href = typeof data === 'string' && data.startsWith('/media/') ? data : '#'
      f.target = '_blank'
      f.rel = 'noopener'
      f.textContent = msg.media.name || t('mediaFileFallbackName')
      box.appendChild(f)
    }
    div.appendChild(box)
  }

  if (msg.text) {
    const text = document.createElement('div')
    text.className = 'message-text'
    fillElementWithAppleEmoji(text, msg.text)
    div.appendChild(text)
  } else if (
    msg.media &&
    (msg.media.type === 'audio' || msg.media.type === 'voice')
  ) {
    div.classList.add('message--voice-only')
  }

  const chips = msg.is_scheduled ? '' : renderReactionChips(msg)

  const time = document.createElement('div')
  time.className = 'message-time'
  const timeInner = document.createElement('span')
  timeInner.textContent = msg.is_scheduled
    ? formatTime(msg.scheduled_at || msg.timestamp)
    : formatTime(msg.timestamp)
  time.appendChild(timeInner)
  if (msg.edited) {
    const ed = document.createElement('span')
    ed.className = 'message-edited'
    ed.textContent = ` · ${t('messageEdited')}`
    time.appendChild(ed)
  }
  if (!msg.is_scheduled) {
    time.insertAdjacentHTML('beforeend', readReceiptMarkup(msg, state.currentRoom || ''))
  }

  if (chips) {
    const footer = document.createElement('div')
    footer.className = 'message-footer'
    footer.appendChild(chips)
    footer.appendChild(time)
    div.appendChild(footer)
  } else {
    div.appendChild(time)
  }

  div.addEventListener('contextmenu', (e) => openMessageContext(e, msg))
  div.addEventListener('touchstart', onMsgTouchStart.bind(null, msg), { passive: true })
  div.addEventListener('touchend', onMsgTouchEnd, { passive: true })
  div.addEventListener('touchmove', onMsgTouchEnd, { passive: true })

  if (playEnter) {
    div.classList.add('message--nebula-enter')
    div.addEventListener(
      'animationend',
      (ev) => {
        if (ev.target !== div) return
        const n = String(ev.animationName || '')
        if (n && !n.includes('nebula-msg')) return
        div.classList.remove('message--nebula-enter')
      },
      { once: true },
    )
  }

  div.dataset.domFp = messageDomFingerprint(msg)
  return div
}

/** Слияние ответа сервера с уже показанными сообщениями (гонка history/HTTP vs receive_message). */
export function mergeHistoryWithExisting(fetchedNorm, previousNorm) {
  const merged = new Map(fetchedNorm.map((m) => [String(m.message_id), m]))
  for (const m of previousNorm) {
    const id = String(m.message_id)
    const cur = merged.get(id)
    if (!cur) merged.set(id, m)
    else if (m.expires_at && !cur.expires_at) cur.expires_at = m.expires_at
  }
  return Array.from(merged.values()).sort((a, b) => {
    const ta = Date.parse(a.timestamp || '') || 0
    const tb = Date.parse(b.timestamp || '') || 0
    return ta - tb
  })
}

function updateComposerChrome() {
  /* Блок «Ответ» только при явном reply; при пустой истории ответ сбрасываем */
  if (state.messages.length === 0) {
    state.replyTo = null
  }
  updateReplyPreview()
}

/**
 * @param {{ playEnterMessageId?: string | number | null }} [opts]
 *        `playEnterMessageId` — `receive_message`: CSS-анимация появления (см. `message--nebula-enter`),
 *        узел с этим классом нужно удерживать при промежуточных re-render.
 */
export function renderMessages(opts = {}) {
  const playEnterId =
    opts.playEnterMessageId != null && String(opts.playEnterMessageId) !== ''
      ? String(opts.playEnterMessageId)
      : null
  const scrollMode = opts.scrollMode || 'bottom'
  const container = els.messagesContainer
  if (!container) return

  const stickToBottom =
    scrollMode === 'bottom' && (opts.forceScrollBottom === true || isNearChatBottom(container))

  let prevScrollHeight = 0
  let prevScrollTop = 0
  if (scrollMode === 'preserve') {
    prevScrollHeight = container.scrollHeight
    prevScrollTop = container.scrollTop
  }

  const displayMessages = getDisplayMessages()
  if (displayMessages.length === 0) {
    container.innerHTML = ''
    if (els.chatEmptyState) els.chatEmptyState.hidden = false
    updateComposerChrome()
    container.scrollTop = 0
    return
  }

  const wantIds = new Set(displayMessages.map((m) => String(m.message_id)))
  const forceRebuild = new Set(
    (opts.forceRebuildIds || []).map((id) => String(id)).filter(Boolean),
  )

  /** Узлы в анимации: leave / enter (CSS) / nebula-enter (вход по `playEnterMessageId`). */
  const preservedById = new Map()
  const reusableById = new Map()
  for (const node of Array.from(container.children)) {
    if (!node.classList?.contains('message')) {
      node.remove()
      continue
    }
    const id = node.dataset.messageId
    if (id == null || id === '') {
      node.remove()
      continue
    }
    const sid = String(id)
    const animating =
      node.classList.contains('message--leaving') ||
      node.classList.contains('message--entering') ||
      node.classList.contains('message--nebula-enter')
    if (animating) {
      if (wantIds.has(sid) || node.classList.contains('message--leaving')) {
        preservedById.set(sid, node)
      } else {
        node.remove()
      }
      continue
    }
    if (!wantIds.has(sid)) {
      node.remove()
      continue
    }
    if (forceRebuild.has(sid) || (playEnterId && sid === playEnterId)) {
      node.remove()
    } else {
      reusableById.set(sid, node)
    }
  }

  const frag = document.createDocumentFragment()
  for (const msg of displayMessages) {
    const id = String(msg.message_id)
    const ghost = preservedById.get(id)
    if (ghost) {
      frag.appendChild(ghost)
      preservedById.delete(id)
      reusableById.delete(id)
      continue
    }
    const reused = reusableById.get(id)
    const fp = messageDomFingerprint(msg)
    if (reused) {
      if (reused.dataset.domFp === fp) {
        frag.appendChild(reused)
        reusableById.delete(id)
        continue
      }
      reused.remove()
    }
    const doEnter = playEnterId && id === playEnterId
    frag.appendChild(buildMessageElement(msg, { playEnter: doEnter }))
  }
  /** Уходящие узлы, которых уже нет в state.messages (commit() ещё не произошёл),
   *  всё равно держим в DOM до конца leave-анимации. */
  for (const ghost of preservedById.values()) {
    frag.appendChild(ghost)
  }
  for (const orphan of reusableById.values()) {
    orphan.remove()
  }
  container.appendChild(frag)

  if (els.chatEmptyState) {
    els.chatEmptyState.hidden = container.childElementCount > 0
  }
  updateComposerChrome()
  if (scrollMode === 'preserve') {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!els.messagesContainer) return
        try {
          const c = els.messagesContainer
          c.scrollTop = c.scrollHeight - prevScrollHeight + prevScrollTop
        } catch {
          /* ignore */
        }
      })
    })
    return
  }
  if (scrollMode === 'none') return
  if (!stickToBottom) return
  /** Скролл после 2× rAF: 1) смонтировали keyframes, 2) сняли кадр, 3) тогда вниз — иначе
   *  `scrollTop` в том же кадре, что `append`, «съедает» визуально появление. */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!els.messagesContainer) return
      try {
        els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight
      } catch {
        /* ignore */
      }
    })
  })
}

export function markVisibleAsRead() {
  const sock = getSocket()
  if (!sock?.connected || !state.currentRoom) return
  const me = getUsername()
  if (!me) return
  const messagesToMark = state.messages
    .filter((m) => m.username !== me && !(m.read_by || []).includes(me))
    .slice(-40)
  const messageIds = messagesToMark
    .map((m) => m.message_id)
    .filter((id) => id != null && String(id) !== '')
  if (!messageIds.length) return
  messagesToMark.forEach((m) => {
    m.read_by = Array.isArray(m.read_by) ? [...m.read_by, me] : [me]
  })
  sock.emit('mark_read_batch', {
    room: state.currentRoom,
    message_ids: messageIds,
    username: me,
  })
}

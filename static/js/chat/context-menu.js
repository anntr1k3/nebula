/**
 * Контекст-меню сообщения и полоса быстрых реакций + расширенный эмодзи-пикер.
 * Ответственности:
 *   - open/close контекст-меню сообщения, управление backdrop'ом эмодзи-пикера;
 *   - копирование текста в буфер обмена (с fallback на execCommand);
 *   - long-press на мобильных → быстрая полоса реакций;
 *   - модалка подтверждения удаления сообщения (биндинг и состояние).
 *
 * Удаление и редактирование сообщений делегируются: удаление — через локальную
 * модалку; редактирование — через `openEditMessageModal` из `./composer.js`.
 */

import * as api from '../api.js'
import { getToken, getUsername } from '../auth.js'
import { t, translateApiMessage } from '../i18n.js'
import { getSocket } from '../socket.js'
import { els, state, showToast } from '../app-shell.js'
import { createAppleEmojiImg } from '../emoji-apple.js'
import { openSmoothModal, closeSmoothModal } from '../modal-smooth.js'
import { EXPANDED_EMOJI_LIST, POPOVER_CLOSE_MS, REACTIONS } from './constants.js'
import { isMessagePinned } from './rooms.js'
import {
  closeComposerPopovers,
  openEditMessageModal,
  updateReplyPreview,
} from './composer.js'

// -----------------------------------------------------------------------------
// Реакции (emoji) + буфер обмена + touch
// -----------------------------------------------------------------------------

export function toggleReaction(messageId, emoji) {
  const sock = getSocket()
  if (!sock?.connected || !state.currentRoom) return
  sock.emit('add_reaction', {
    room: state.currentRoom,
    message_id: messageId,
    emoji,
    username: getUsername(),
  })
}

/** Копирование текста в буфер обмена с fallback на устаревший execCommand. */
async function copyTextToClipboard(text) {
  if (!text) return false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* попробуем execCommand ниже */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function onMsgTouchStart(msg) {
  clearTimeout(state.longPressTimer)
  state.longPressTimer = setTimeout(() => {
    showEmojiBarForMessage(msg)
  }, 550)
}

export function onMsgTouchEnd() {
  clearTimeout(state.longPressTimer)
}

// -----------------------------------------------------------------------------
// Контекст-меню / быстрые реакции — закрытие
// -----------------------------------------------------------------------------

/** Только меню по сообщению и emoji-полоса (без TTL / отложенной отправки). */
export function closeCtxMenuAndEmoji() {
  els.ctxMenu.classList.remove('ctx-menu--open')
  els.emojiBar.classList.remove('emoji-bar--visible')
  els.emojiBar.hidden = true
  if (els.emojiPickerExpanded) {
    els.emojiPickerExpanded.classList.remove('emoji-picker-expanded--visible')
    els.emojiPickerExpanded.hidden = true
  }
  if (els.emojiPickerBackdrop) els.emojiPickerBackdrop.hidden = true
  state.contextMessage = null
  window.clearTimeout(closeContextMenus._t)
  closeContextMenus._t = window.setTimeout(() => {
    els.ctxMenu.hidden = true
    els.ctxMenu.classList.remove('ctx-menu--own', 'ctx-menu--theirs')
  }, POPOVER_CLOSE_MS)
}

/** Полное закрытие: контекст чата + всплывающие панели композера. */
export function closeContextMenus() {
  closeComposerPopovers()
  closeCtxMenuAndEmoji()
}

// -----------------------------------------------------------------------------
// Модалка подтверждения удаления сообщения
// -----------------------------------------------------------------------------

let pendingDeleteMessage = null
let pendingReportMessage = null

export function clearPendingDeleteMessage() {
  pendingDeleteMessage = null
  pendingReportMessage = null
}

/** Привязка обработчиков модалки удаления (идемпотентно). */
export function bindDeleteMessageModal() {
  if (!els.modalDeleteMessage || !els.btnDeleteMessageConfirm || !els.btnDeleteMessageCancel) return
  if (els.modalDeleteMessage.dataset.deleteModalBound === '1') return
  els.modalDeleteMessage.dataset.deleteModalBound = '1'
  els.btnDeleteMessageConfirm.addEventListener('click', () => {
    const msg = pendingDeleteMessage
    pendingDeleteMessage = null
    closeSmoothModal(els.modalDeleteMessage)
    if (!msg || !state.currentRoom) return
    getSocket()?.emit('delete_message', {
      room: state.currentRoom,
      message_id: msg.message_id,
      username: getUsername(),
    })
  })
  els.btnDeleteMessageCancel.addEventListener('click', () => {
    pendingDeleteMessage = null
    closeSmoothModal(els.modalDeleteMessage)
  })
  els.modalDeleteMessage.addEventListener('click', (e) => {
    if (e.target === els.modalDeleteMessage) {
      pendingDeleteMessage = null
      closeSmoothModal(els.modalDeleteMessage)
    }
  })
}

export function closeReportMessageModal() {
  pendingReportMessage = null
  if (els.reportMessageInput) els.reportMessageInput.value = ''
  closeSmoothModal(els.modalReportMessage)
}

async function submitReportMessage() {
  const msg = pendingReportMessage
  if (!msg) {
    closeReportMessageModal()
    return
  }
  const reason =
    (els.reportMessageInput?.value || '').trim() || t('reportDefaultReason')
  closeReportMessageModal()
  const r = await api.reportMessage(
    {
      messageId: msg.message_id,
      reportedBy: getUsername(),
      reportedUser: msg.username,
      reason,
    },
    getToken(),
  )
  if (r.success) showToast(t('reportSentOk'), 'success')
  else showToast(translateApiMessage(r.message) || t('genericError'), 'error')
}

export function bindReportMessageModal() {
  if (
    !els.modalReportMessage ||
    !els.reportMessageInput ||
    !els.btnReportMessageConfirm ||
    !els.btnReportMessageCancel
  ) {
    return
  }
  if (els.modalReportMessage.dataset.reportModalBound === '1') return
  els.modalReportMessage.dataset.reportModalBound = '1'
  els.btnReportMessageConfirm.addEventListener('click', () => {
    void submitReportMessage()
  })
  els.btnReportMessageCancel.addEventListener('click', closeReportMessageModal)
  els.modalReportMessage.addEventListener('click', (e) => {
    if (e.target === els.modalReportMessage) closeReportMessageModal()
  })
  els.reportMessageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeReportMessageModal()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void submitReportMessage()
    }
  })
}

// -----------------------------------------------------------------------------
// Открытие контекст-меню
// -----------------------------------------------------------------------------

export function openMessageContext(e, msg) {
  /* Не блокируем системное меню на изображениях, видео, аудио и ссылке на файл — «Сохранить как…», плеер и т.д. */
  if (
    e.target &&
    e.target instanceof Element &&
    e.target.closest(
      'button.message-media-link, .message-media-open-viewer, a.message-file, .message-media img, .message-media video, .message-media audio',
    )
  ) {
    return
  }
  e.preventDefault()
  closeComposerPopovers()
  state.contextMessage = msg
  els.emojiBar.classList.remove('emoji-bar--visible')
  els.emojiBar.hidden = true
  if (els.emojiPickerExpanded) {
    els.emojiPickerExpanded.classList.remove('emoji-picker-expanded--visible')
    els.emojiPickerExpanded.hidden = true
  }
  if (els.emojiPickerBackdrop) els.emojiPickerBackdrop.hidden = true
  els.ctxMenu.innerHTML = ''
  const isOwn = msg.username === getUsername()
  els.ctxMenu.classList.remove('ctx-menu--open')
  els.ctxMenu.classList.toggle('ctx-menu--own', isOwn)
  els.ctxMenu.classList.toggle('ctx-menu--theirs', !isOwn)

  const copyMessageText = () => {
    const text = msg.text || ''
    if (!text) return
    copyTextToClipboard(text).then((ok) => {
      if (ok) showToast(t('copiedToClipboard'), 'success')
      else showToast(t('copyFailed'), 'error')
    })
  }

  const appendMenuItem = (label, fn, { destructive = false, icon = null } = {}) => {
    const b = document.createElement('button')
    b.type = 'button'
    if (destructive) b.classList.add('destructive')
    if (icon) {
      const i = document.createElement('i')
      i.className = `fa-solid ${icon} ctx-menu-icon`
      i.setAttribute('aria-hidden', 'true')
      const span = document.createElement('span')
      span.className = 'ctx-menu-label'
      span.textContent = label
      b.appendChild(i)
      b.appendChild(span)
    } else {
      b.textContent = label
    }
    b.addEventListener('click', (ev) => {
      // Prevent the document-level click handler from immediately closing
      // newly opened panels (emoji bar / pickers).
      ev.stopPropagation()
      closeContextMenus()
      fn()
    })
    els.ctxMenu.appendChild(b)
  }

  const menuItems = []

  if (!msg.is_scheduled) {
    menuItems.push({
      label: t('replyTo'),
      icon: 'fa-reply',
      fn: () => {
        state.replyTo = {
          message_id: msg.message_id,
          username: msg.username,
          text: msg.text,
        }
        updateReplyPreview()
      },
    })
    menuItems.push({
      label: t('addReaction'),
      icon: 'fa-face-smile',
      fn: () => showEmojiBarForMessage(msg),
    })
    if (msg.text) {
      menuItems.push({
        label: t('copyMessage'),
        icon: 'fa-copy',
        fn: copyMessageText,
      })
    }
    const pinned = isMessagePinned(msg.message_id)
    menuItems.push({
      label: pinned ? t('unpinMessage') : t('pinMessage'),
      icon: 'fa-thumbtack',
      fn: () => {
        const evName = pinned ? 'unpin_message' : 'pin_message'
        getSocket()?.emit(evName, {
          room_id: state.currentRoom,
          message_id: msg.message_id,
          username: getUsername(),
        })
      },
    })
    if (isOwn) {
      menuItems.push({
        label: t('editMessage'),
        icon: 'fa-pen',
        fn: () => openEditMessageModal(msg),
      })
      menuItems.push({
        label: t('deleteMessage'),
        icon: 'fa-trash',
        destructive: true,
        fn: () => {
          pendingDeleteMessage = msg
          openSmoothModal(els.modalDeleteMessage)
        },
      })
    } else {
      menuItems.push({
        label: t('reportMessage'),
        icon: 'fa-flag',
        destructive: true,
        fn: () => {
          pendingReportMessage = msg
          if (els.reportMessageInput) els.reportMessageInput.value = ''
          openSmoothModal(els.modalReportMessage)
          requestAnimationFrame(() => els.reportMessageInput?.focus())
        },
      })
    }
  }

  menuItems.forEach((item) =>
    appendMenuItem(item.label, item.fn, {
      destructive: item.destructive,
      icon: item.icon,
    }),
  )

  els.ctxMenu.hidden = false
  void els.ctxMenu.offsetWidth
  const mw = els.ctxMenu.offsetWidth
  const mh = els.ctxMenu.offsetHeight
  const bubble = e.currentTarget.getBoundingClientRect()
  let left = isOwn ? bubble.left - mw - 8 : bubble.right + 8
  let top = bubble.top + bubble.height / 2 - mh / 2
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8))
  top = Math.max(8, Math.min(top, window.innerHeight - mh - 8))
  els.ctxMenu.style.left = `${left}px`
  els.ctxMenu.style.top = `${top}px`
  requestAnimationFrame(() => {
    requestAnimationFrame(() => els.ctxMenu.classList.add('ctx-menu--open'))
  })
}

// -----------------------------------------------------------------------------
// Расширенный эмодзи-пикер и быстрая полоса реакций
// -----------------------------------------------------------------------------

function ensureExpandedEmojiPickerBuilt() {
  const root = els.emojiPickerExpanded
  if (!root || root.dataset.built === '2') return
  root.innerHTML = ''
  root.dataset.built = '2'
  const header = document.createElement('div')
  header.className = 'emoji-picker-expanded-header'
  const title = document.createElement('span')
  title.className = 'emoji-picker-expanded-title'
  title.textContent = t('emojiPickerTitle')
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'emoji-picker-expanded-close'
  closeBtn.setAttribute('aria-label', t('closeButton'))
  closeBtn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>'
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    closeContextMenus()
  })
  header.appendChild(title)
  header.appendChild(closeBtn)
  const grid = document.createElement('div')
  grid.className = 'emoji-picker-expanded-grid'
  EXPANDED_EMOJI_LIST.forEach((em) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'emoji-picker-expanded-item'
    b.dataset.emoji = em
    const img = createAppleEmojiImg(em, 'emoji-picker-expanded-img')
    img.loading = 'lazy'
    b.appendChild(img)
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      const target = state.contextMessage
      if (target) toggleReaction(target.message_id, em)
      closeContextMenus()
    })
    grid.appendChild(b)
  })
  root.appendChild(header)
  root.appendChild(grid)
}

function positionExpandedEmojiPicker() {
  const panel = els.emojiPickerExpanded
  if (!panel || panel.hidden) return
  const gap = 8
  const bar = els.emojiBar
  const midClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

  // Measure panel size (must be visible to measure).
  panel.style.left = '8px'
  panel.style.top = '8px'
  panel.style.right = 'auto'
  panel.style.bottom = 'auto'
  const pw = panel.offsetWidth
  const ph = panel.offsetHeight

  if (!bar.hidden) {
    const br = bar.getBoundingClientRect()
    const preferBelow = br.bottom + gap + ph <= window.innerHeight - 8
    const top = preferBelow ? br.bottom + gap : Math.max(8, br.top - gap - ph)
    let left = br.left
    if (left + pw > window.innerWidth - 8) left = br.right - pw
    left = midClamp(left, 8, window.innerWidth - pw - 8)
    panel.style.left = `${left}px`
    panel.style.top = `${top}px`
    return
  }

  // If the emoji bar is not open, anchor near the message bubble (if any).
  const msg = state.contextMessage
  const msgEl = msg
    ? document.querySelector(
        `.message[data-message-id="${CSS.escape(String(msg.message_id || ''))}"]`,
      )
    : null
  const mr = msgEl?.getBoundingClientRect?.()
  if (mr && pw && ph) {
    const preferBelow = mr.bottom + gap + ph <= window.innerHeight - 8
    const top = preferBelow ? mr.bottom + gap : Math.max(8, mr.top - gap - ph)
    let left = mr.left + mr.width / 2 - pw / 2
    left = midClamp(left, 8, window.innerWidth - pw - 8)
    panel.style.left = `${left}px`
    panel.style.top = `${top}px`
    return
  }

  const wrap = els.composerOuter || document.querySelector('.composer-outer')
  const inputRow = els.messageInput?.closest('.message-input-container')
  let r = wrap?.getBoundingClientRect()
  if (!r || r.height < 4) r = inputRow?.getBoundingClientRect()
  const anchorTooHigh = !r || r.top < 56
  if (anchorTooHigh) {
    const ir = inputRow?.getBoundingClientRect()
    if (ir && ir.top > 20) r = ir
  }
  if (r && r.top > 12) {
    const bottomPx = Math.max(8, window.innerHeight - r.top + gap)
    panel.style.right = `${Math.max(8, window.innerWidth - r.right)}px`
    panel.style.bottom = `${bottomPx}px`
  } else {
    const rect = els.messagesContainer?.getBoundingClientRect()
    panel.style.right = '16px'
    panel.style.bottom = `${Math.max(8, window.innerHeight - (rect?.bottom ?? 0) + gap)}px`
  }
  panel.style.left = 'auto'
  panel.style.top = 'auto'
}

function openExpandedEmojiPicker(msg) {
  state.contextMessage = msg
  ensureExpandedEmojiPickerBuilt()
  const el = els.emojiPickerExpanded
  if (!el) return
  if (els.emojiPickerBackdrop) els.emojiPickerBackdrop.hidden = false
  el.classList.remove('emoji-picker-expanded--visible')
  el.hidden = false
  positionExpandedEmojiPicker()
  void el.offsetWidth
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.classList.add('emoji-picker-expanded--visible')
    })
  })
}

export function showEmojiBarForMessage(msg) {
  state.contextMessage = msg
  closeComposerPopovers()
  els.ctxMenu.classList.remove('ctx-menu--open')
  window.clearTimeout(closeContextMenus._t)
  els.ctxMenu.hidden = true
  els.ctxMenu.classList.remove('ctx-menu--own', 'ctx-menu--theirs')
  if (els.emojiPickerExpanded) {
    els.emojiPickerExpanded.classList.remove('emoji-picker-expanded--visible')
    els.emojiPickerExpanded.hidden = true
  }
  els.emojiBar.innerHTML = ''
  REACTIONS.forEach((em) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'emoji-bar-emoji'
    b.dataset.emoji = em
    const img = createAppleEmojiImg(em, 'emoji-bar-emoji-img')
    img.width = 28
    img.height = 28
    b.appendChild(img)
    b.addEventListener('click', () => {
      toggleReaction(msg.message_id, em)
      closeContextMenus()
    })
    els.emojiBar.appendChild(b)
  })
  const more = document.createElement('button')
  more.type = 'button'
  more.className = 'emoji-bar-more'
  more.textContent = t('moreReactions')
  more.addEventListener('click', (e) => {
    e.stopPropagation()
    openExpandedEmojiPicker(msg)
  })
  els.emojiBar.appendChild(more)
  const closeStrip = document.createElement('button')
  closeStrip.type = 'button'
  closeStrip.className = 'emoji-bar-close'
  closeStrip.setAttribute('aria-label', t('closeButton'))
  closeStrip.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>'
  closeStrip.addEventListener('click', (e) => {
    e.stopPropagation()
    closeContextMenus()
  })
  els.emojiBar.appendChild(closeStrip)
  els.emojiBar.classList.remove('emoji-bar--visible')
  els.emojiBar.hidden = false
  els.emojiBar.style.top = 'auto'
  els.emojiBar.style.left = 'auto'
  els.emojiBar.style.right = 'auto'
  els.emojiBar.style.bottom = 'auto'
  const gap = 8
  const midClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const msgEl = document.querySelector(
    `.message[data-message-id="${CSS.escape(String(msg?.message_id ?? ''))}"]`,
  )
  const r = msgEl?.getBoundingClientRect?.()

  // Measure after the element is in DOM and visible.
  els.emojiBar.style.left = '8px'
  els.emojiBar.style.top = '8px'
  const bw = els.emojiBar.offsetWidth
  const bh = els.emojiBar.offsetHeight

  if (r && bw && bh) {
    const isOwn = msg.username === getUsername()
    const preferBelow = r.bottom + gap + bh <= window.innerHeight - 8
    const top = preferBelow ? r.bottom + gap : Math.max(8, r.top - gap - bh)
    let left = isOwn ? r.right - bw : r.left
    // If not enough room on chosen side, center it under the bubble.
    if (left < 8 || left + bw > window.innerWidth - 8) {
      left = r.left + r.width / 2 - bw / 2
    }
    left = midClamp(left, 8, window.innerWidth - bw - 8)
    els.emojiBar.style.left = `${left}px`
    els.emojiBar.style.top = `${top}px`
  } else {
    // Fallback: near the lower-right corner.
    els.emojiBar.style.right = '16px'
    els.emojiBar.style.bottom = '16px'
  }
  /* Подложка на весь экран — иначе клик «мимо» полоски реакций не закрывает меню. */
  if (els.emojiPickerBackdrop) els.emojiPickerBackdrop.hidden = false
  void els.emojiBar.offsetWidth
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      els.emojiBar.classList.add('emoji-bar--visible')
    })
  })
}

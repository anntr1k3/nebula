/**
 * Композер сообщения и его окружение: ввод, авторесайз, кнопка «отправить»,
 * typing-индикатор, черновик комнаты, предпросмотр reply, всплывающие панели
 * TTL и отложенной отправки, модалка редактирования сообщения, восстановление
 * текста композера при отклонении сервером.
 */

import * as api from '../api.js'
import { getToken, getUsername } from '../auth.js'
import { t, translateApiMessage } from '../i18n.js'
import { getSocket } from '../socket.js'
import { els, state, showToast } from '../app-shell.js'
import { $ } from '../dom.js'
import {
  normalizeComposerEmojiInPlace,
  fillElementWithAppleEmoji,
  plainTextFromComposerRoot,
  setComposerPlainText,
  syncComposerEmptyAttr,
} from '../emoji-apple.js'
import { openSmoothModal, closeSmoothModal } from '../modal-smooth.js'
import { scheduleInboxRefresh } from '../inbox.js'
import { POPOVER_CLOSE_MS } from './constants.js'

// -----------------------------------------------------------------------------
// Черновик и typing
// -----------------------------------------------------------------------------

export async function loadDraftForCurrentRoom() {
  if (!state.currentRoom || !els.messageInput) return
  try {
    const d = await api.getDraft(getUsername(), state.currentRoom, getToken())
    if (d.success && d.text) setComposerPlainText(els.messageInput, d.text)
    else setComposerPlainText(els.messageInput, '')
  } catch {
    /* ignore */
  }
  updateSendButtonState()
  autosizeTextarea()
}

export function scheduleDraftSave() {
  clearTimeout(state.draftSaveTimer)
  state.draftSaveTimer = setTimeout(() => {
    const room = state.currentRoom
    if (!room || !els.messageInput) return
    const text = plainTextFromComposerRoot(els.messageInput) ?? ''
    void api.saveDraft(getUsername(), room, text, getToken())
    scheduleInboxRefresh()
  }, 900)
}

function emitTyping() {
  const sock = getSocket()
  if (!sock?.connected || !state.currentRoom) return
  const now = Date.now()
  if (now - state.lastTypingEmit < 800) return
  state.lastTypingEmit = now
  sock.emit('typing', { room: state.currentRoom, username: getUsername() })
}

export function emitStopTyping() {
  const sock = getSocket()
  if (!sock?.connected || !state.currentRoom) return
  sock.emit('stop_typing', { room: state.currentRoom, username: getUsername() })
}

export function onInputTyping() {
  emitTyping()
  clearTimeout(state.typingHideTimer)
  state.typingHideTimer = setTimeout(emitStopTyping, 2000)
}

export function setTypingIndicator(names) {
  if (!names.length) {
    els.typingBar.hidden = true
    els.typingBar.textContent = ''
    return
  }
  els.typingBar.hidden = false
  els.typingBar.textContent = `${names.join(', ')} ${t('typing')}`
}

// -----------------------------------------------------------------------------
// Базовый композер
// -----------------------------------------------------------------------------

const MEDIA_PREVIEW_ICONS = {
  image: 'image',
  video: 'video',
  voice: 'microphone',
  audio: 'music',
  file: 'file-lines',
}

function friendlyAttachmentLabel(media) {
  const type = media?.type || 'file'
  const key = {
    image: 'attachPreviewImage',
    video: 'attachPreviewVideo',
    voice: 'attachPreviewVoice',
    audio: 'attachPreviewAudio',
  }[type]
  if (key) return t(key)
  const name = (media?.name || '').trim()
  if (!name) return t('attachPreviewFile')
  if (name.length <= 28) return name
  const dot = name.lastIndexOf('.')
  if (dot > 0 && dot < name.length - 1) {
    return `${name.slice(0, 12)}…${name.slice(dot)}`
  }
  return `${name.slice(0, 24)}…`
}

export function updatePendingMediaPreview() {
  const wrap = els.composerMediaPreview
  if (!wrap) return
  const media = state.pendingMedia
  if (!media) {
    wrap.hidden = true
    if (els.composerMediaPreviewThumb) els.composerMediaPreviewThumb.hidden = true
    if (els.composerMediaPreviewIcon) els.composerMediaPreviewIcon.hidden = false
    return
  }
  wrap.hidden = false
  if (els.composerMediaPreviewLabel) {
    els.composerMediaPreviewLabel.textContent = friendlyAttachmentLabel(media)
  }
  const iconName = MEDIA_PREVIEW_ICONS[media.type] || MEDIA_PREVIEW_ICONS.file
  const iconEl = els.composerMediaPreviewIcon?.querySelector('i')
  if (iconEl) {
    iconEl.className = `fa-solid fa-${iconName}`
  }
  const path = typeof media.data === 'string' ? media.data : ''
  const isImage = media.type === 'image' && path.startsWith('/media/')
  if (els.composerMediaPreviewThumb) {
    if (isImage) {
      els.composerMediaPreviewThumb.hidden = false
      els.composerMediaPreviewThumb.src = path
      if (els.composerMediaPreviewIcon) els.composerMediaPreviewIcon.hidden = true
    } else {
      els.composerMediaPreviewThumb.hidden = true
      els.composerMediaPreviewThumb.removeAttribute('src')
      if (els.composerMediaPreviewIcon) els.composerMediaPreviewIcon.hidden = false
    }
  }
}

export function clearPendingMedia() {
  state.pendingMedia = null
  updateSendButtonState()
}

export function updateSendButtonState() {
  if (!els.messageInput || !els.btnSend) return
  const text = plainTextFromComposerRoot(els.messageInput).trim()
  const ok = (text.length > 0 || !!state.pendingMedia) && !!state.currentRoom
  els.btnSend.disabled = !ok
  updatePendingMediaPreview()
}

export function autosizeTextarea() {
  const el = els.messageInput
  if (!el) return
  const max = 132
  el.style.overflowY = 'hidden'
  el.style.height = 'auto'
  const next = Math.min(el.scrollHeight, max)
  el.style.height = `${next}px`
  if (el.scrollHeight > max) {
    el.style.overflowY = 'auto'
  }
}

/** Ввод в поле сообщения: только Apple-эмодзи + прежняя логика кнопки/черновика. */
export function handleComposerInput() {
  if (!els.messageInput) return
  normalizeComposerEmojiInPlace(els.messageInput)
  syncComposerEmptyAttr(els.messageInput)
  updateSendButtonState()
  autosizeTextarea()
  onInputTyping()
  scheduleDraftSave()
}

export function updateReplyPreview() {
  const show = !!state.replyTo
  if (show) {
    els.replyPreview.hidden = false
    fillElementWithAppleEmoji(
      els.replyPreviewText,
      `${state.replyTo.username}: ${(state.replyTo.text || '').slice(0, 120)}`,
    )
  } else {
    els.replyPreview.hidden = true
    els.replyPreviewText.textContent = ''
  }
}

// -----------------------------------------------------------------------------
// Восстановление текста при серверной ошибке отправки
// -----------------------------------------------------------------------------

let pendingSendRestore = null
let sendRestoreClearTimer = null

function clearSendRestoreTimer() {
  if (sendRestoreClearTimer) {
    clearTimeout(sendRestoreClearTimer)
    sendRestoreClearTimer = null
  }
}

function scheduleClearSendRestore() {
  clearSendRestoreTimer()
  sendRestoreClearTimer = setTimeout(() => {
    pendingSendRestore = null
    sendRestoreClearTimer = null
  }, 2200)
}

export function onSocketAppError(e) {
  const rawMsg = e.detail?.message
  const msg =
    rawMsg != null && typeof rawMsg === 'string'
      ? translateApiMessage(rawMsg) || rawMsg
      : ''
  clearSendRestoreTimer()
  const r = pendingSendRestore
  pendingSendRestore = null
  const canRestore =
    r &&
    Date.now() - r.at < 6000 &&
    r.room === state.currentRoom &&
    state.currentRoom
  if (canRestore) {
    setComposerPlainText(els.messageInput, r.text)
    if (els.ttlSelect && r.ttl !== undefined && r.ttl !== null) els.ttlSelect.value = r.ttl
    state.replyTo = r.replyTo
    state.pendingMedia = r.pendingMedia
    updateReplyPreview()
    updateSendButtonState()
    autosizeTextarea()
  }
  if (msg) showToast(msg, 'error')
}

// -----------------------------------------------------------------------------
// Отправка
// -----------------------------------------------------------------------------

/**
 * @param {{ text?: string, media?: object | null }} [options]
 *   `media` — явная вложенная медиа (например голосовое сразу после записи).
 */
export async function sendMessage(options = {}) {
  if (!els.messageInput) return
  const hasMediaOverride = Object.prototype.hasOwnProperty.call(options, 'media')
  const text =
    options.text !== undefined
      ? String(options.text || '').trim()
      : plainTextFromComposerRoot(els.messageInput).trim()
  const mediaPayload = hasMediaOverride
    ? options.media
      ? { ...options.media }
      : null
    : state.pendingMedia
      ? { ...state.pendingMedia }
      : null
  if ((!text && !mediaPayload) || !state.currentRoom) return
  const sock = getSocket()
  if (!sock?.connected) {
    showToast(t('loginError'), 'error')
    return
  }

  const payload = {
    room: state.currentRoom,
    username: getUsername(),
    message: text,
  }
  if (state.replyTo) {
    payload.replyTo = {
      id: state.replyTo.message_id,
      username: state.replyTo.username,
      text: state.replyTo.text,
    }
  }
  if (mediaPayload) payload.media = mediaPayload
  const ttlRaw = els.ttlSelect?.value
  if (ttlRaw) {
    const n = parseInt(ttlRaw, 10)
    if (n > 0) payload.ttl_seconds = n
  }
  if (mediaPayload?.meta && typeof mediaPayload.meta === 'object') {
    payload.media_meta = mediaPayload.meta
  }

  pendingSendRestore = {
    at: Date.now(),
    text: plainTextFromComposerRoot(els.messageInput),
    room: state.currentRoom,
    replyTo: state.replyTo,
    pendingMedia: hasMediaOverride ? null : state.pendingMedia,
    ttl: els.ttlSelect?.value ?? '',
  }
  scheduleClearSendRestore()

  sock.emit('send_message', payload)
  setComposerPlainText(els.messageInput, '')
  if (els.ttlSelect) {
    els.ttlSelect.value = ''
    syncTtlDisplay()
    updateTtlActiveInPopover()
  }
  state.pendingMedia = null
  state.replyTo = null
  void api.saveDraft(getUsername(), state.currentRoom, '', getToken())
  updateReplyPreview()
  updateSendButtonState()
  autosizeTextarea()
  emitStopTyping()
  scheduleInboxRefresh()
}

// -----------------------------------------------------------------------------
// TTL / schedule попоперы
// -----------------------------------------------------------------------------

function ttlLabelForValue(v) {
  if (!v) return t('ttlOff')
  const map = {
    '5': 'ttlDur5s',
    '60': 'ttlDur1m',
    '3600': 'ttlDur1h',
    '86400': 'ttlDur24h',
  }
  return t(map[v] || 'ttlOff')
}

export function syncTtlDisplay() {
  const d = $('#ttl-select-display')
  if (d) d.textContent = ttlLabelForValue(els.ttlSelect?.value ?? '')
}

export function rebuildTtlPopover() {
  const root = els.ttlPopover
  if (!root) return
  root.innerHTML = ''
  const spec = [
    { value: '', icon: 'fa-solid fa-ban', labelKey: 'ttlOff' },
    { value: '5', icon: 'fa-solid fa-stopwatch', labelKey: 'ttlDur5s' },
    { value: '60', icon: 'fa-solid fa-clock', labelKey: 'ttlDur1m' },
    { value: '3600', icon: 'fa-solid fa-hourglass', labelKey: 'ttlDur1h' },
    { value: '86400', icon: 'fa-solid fa-hourglass-end', labelKey: 'ttlDur24h' },
  ]
  spec.forEach(({ value, icon, labelKey }) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'composer-float-option'
    b.setAttribute('role', 'option')
    b.dataset.value = value
    b.innerHTML = `<i class="${icon}" aria-hidden="true"></i><span>${t(labelKey)}</span>`
    b.addEventListener('click', (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      if (els.ttlSelect) els.ttlSelect.value = value
      syncTtlDisplay()
      updateTtlActiveInPopover()
      closeComposerPopovers()
    })
    root.appendChild(b)
  })
  updateTtlActiveInPopover()
}

export function updateTtlActiveInPopover() {
  const v = els.ttlSelect?.value ?? ''
  els.ttlPopover?.querySelectorAll('.composer-float-option').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.value === v)
  })
}

export function positionComposerFloat(popEl, anchorEl, kind) {
  window.clearTimeout(closeComposerPopovers._t)
  popEl.hidden = false
  popEl.classList.remove('composer-float--open')
  const r = anchorEl.getBoundingClientRect()
  const ew = Math.max(popEl.offsetWidth || 220, 220)
  const eh = popEl.offsetHeight || 80
  let left = r.left
  let top = r.bottom + 8
  if (kind === 'ttl') {
    left = r.left
    top = r.top - eh - 8
  } else if (kind === 'schedule' || kind === 'ai') {
    left = r.right - ew
    top = r.top - eh - 8
  }
  left = Math.max(8, Math.min(left, window.innerWidth - ew - 8))
  top = Math.max(8, Math.min(top, window.innerHeight - eh - 8))
  popEl.style.left = `${left}px`
  popEl.style.top = `${top}px`
  void popEl.offsetWidth
  requestAnimationFrame(() => {
    requestAnimationFrame(() => popEl.classList.add('composer-float--open'))
  })
}

export function defaultScheduleLocalValue() {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setSeconds(0, 0)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function closeComposerPopovers() {
  if (els.ttlPopover) els.ttlPopover.classList.remove('composer-float--open')
  if (els.schedulePopover) els.schedulePopover.classList.remove('composer-float--open')
  if (els.aiPopover) els.aiPopover.classList.remove('composer-float--open')
  if (els.ttlSelectTrigger) els.ttlSelectTrigger.setAttribute('aria-expanded', 'false')
  if (els.btnAiAssist) els.btnAiAssist.setAttribute('aria-expanded', 'false')
  window.clearTimeout(closeComposerPopovers._t)
  closeComposerPopovers._t = window.setTimeout(() => {
    if (els.ttlPopover) els.ttlPopover.hidden = true
    if (els.schedulePopover) els.schedulePopover.hidden = true
    if (els.aiPopover) els.aiPopover.hidden = true
  }, POPOVER_CLOSE_MS)
}

export function syncTtlSelectLabels() {
  const sel = els.ttlSelect
  if (!sel) return
  sel.querySelectorAll('option[data-i18n-opt]').forEach((opt) => {
    const k = opt.getAttribute('data-i18n-opt')
    if (k) opt.textContent = t(k)
  })
}

// -----------------------------------------------------------------------------
// Модалка редактирования
// -----------------------------------------------------------------------------

let pendingEditMessage = null

/** Открыть модалку редактирования сообщения, предзаполнив текущим текстом. */
export function openEditMessageModal(msg) {
  if (!els.modalEditMessage || !els.editMessageInput) return
  pendingEditMessage = msg
  els.editMessageInput.value = msg.text || ''
  openSmoothModal(els.modalEditMessage)
  requestAnimationFrame(() => {
    if (!els.editMessageInput) return
    els.editMessageInput.focus()
    const v = els.editMessageInput.value
    try {
      els.editMessageInput.setSelectionRange(v.length, v.length)
    } catch {
      /* некоторые textarea не поддерживают setSelectionRange до раскладки */
    }
  })
}

function confirmEditMessage() {
  const msg = pendingEditMessage
  if (!msg) {
    closeSmoothModal(els.modalEditMessage)
    return
  }
  const next = (els.editMessageInput?.value || '').trim()
  if (!next) {
    showToast(t('editMessageEmpty'), 'error')
    els.editMessageInput?.focus()
    return
  }
  if (next === (msg.text || '').trim()) {
    pendingEditMessage = null
    closeSmoothModal(els.modalEditMessage)
    return
  }
  getSocket()?.emit('edit_message', {
    room: state.currentRoom,
    message_id: msg.message_id,
    new_text: next,
    username: getUsername(),
  })
  pendingEditMessage = null
  closeSmoothModal(els.modalEditMessage)
}

function cancelEditMessage() {
  pendingEditMessage = null
  closeSmoothModal(els.modalEditMessage)
}

export function clearPendingEditMessage() {
  pendingEditMessage = null
}

/** Привязка обработчиков модалки редактирования (идемпотентно). */
export function bindEditMessageModal() {
  if (!els.modalEditMessage || !els.btnEditMessageConfirm || !els.btnEditMessageCancel) return
  if (els.modalEditMessage.dataset.editModalBound === '1') return
  els.modalEditMessage.dataset.editModalBound = '1'
  els.btnEditMessageConfirm.addEventListener('click', confirmEditMessage)
  els.btnEditMessageCancel.addEventListener('click', cancelEditMessage)
  els.modalEditMessage.addEventListener('click', (e) => {
    if (e.target === els.modalEditMessage) cancelEditMessage()
  })
  els.editMessageInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancelEditMessage()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      confirmEditMessage()
    }
  })
}

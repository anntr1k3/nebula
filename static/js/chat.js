/**
 * Фасад мессенджера. Сам по себе не содержит доменной логики — только:
 *   1. re-export публичных функций из модулей `./chat/*` (совместимость с app.js / search.js);
 *   2. bootstrap (`bootstrapMessenger`) и биндинг дополнительных UI-обработчиков
 *      (`bindMessengerExtras`), которые объединяют работу нескольких подсистем;
 *   3. сброс состояния при выходе из аккаунта (`resetMessengerAfterLogout`).
 *
 * Декомпозиция по модулям:
 *   - chat/constants.js          константы и длительности анимаций
 *   - chat/messages-render.js    рендер сообщений, слияние истории, read-receipts
 *   - chat/messages-animations.js анимации появления/удаления, подсветка, TTL
 *   - chat/composer.js           ввод, черновик, typing, модалка edit, TTL/schedule попоперы
 *   - chat/context-menu.js       контекст-меню сообщения, быстрые реакции, модалка delete
 *   - chat/rooms.js              открытие/закрытие чата, список комнат, приват, пин-бар
 *   - chat/socket-events.js      подписки на socket.io и синхронизация роли
 */

import * as api from './api.js'
import { getToken, getUsername } from './auth.js'
import { t, translateApiMessage } from './i18n.js'
import { connectSocket } from './socket.js'
import { els, state, showChatHeaderNotice, showToast } from './app-shell.js'
import { onPasteInsertPlainText } from './dom.js'
import { refreshBlockedSet, refreshInbox, scheduleInboxRefresh } from './inbox.js'
import { hideSidebarDropdown } from './sidebar-dropdown.js'
import { fillElementWithAppleEmoji, plainTextFromComposerRoot, setComposerPlainText } from './emoji-apple.js'
import { closeSmoothModal } from './modal-smooth.js'
import { closeMediaViewer } from './media-viewer.js'
import { refreshSidebarProfileLabel } from './settings.js'

import {
  autosizeTextarea,
  bindEditMessageModal,
  closeComposerPopovers,
  clearPendingMedia,
  clearPendingEditMessage,
  defaultScheduleLocalValue,
  handleComposerInput,
  onInputTyping,
  onSocketAppError,
  positionComposerFloat,
  rebuildTtlPopover,
  scheduleDraftSave,
  sendMessage,
  syncTtlDisplay,
  syncTtlSelectLabels,
  updateReplyPreview,
  updateSendButtonState,
  updateTtlActiveInPopover,
} from './chat/composer.js'
import {
  bindDeleteMessageModal,
  bindReportMessageModal,
  clearPendingDeleteMessage,
  closeReportMessageModal,
  closeContextMenus,
  closeCtxMenuAndEmoji,
} from './chat/context-menu.js'
import { scrollToMessageById, syncExpiryWatcher } from './chat/messages-animations.js'
import {
  bindMessagesHistoryScroll,
  bindPinnedListModal,
  closeCurrentChat,
  closePinnedListModal,
  hidePrivateUserSuggest,
  loadRooms,
  loadUsersOnline,
  openChat,
  refreshMessengerHeader,
  refreshMutedRooms,
  syncDndButton,
  syncMobileMessengerLayout,
  updateChatPanelVisibility,
} from './chat/rooms.js'
import { bindSocketEvents, syncRoleFromServer } from './chat/socket-events.js'
import { renderMessages } from './chat/messages-render.js'
import {
  bindScheduledMessageModals,
  clearPendingScheduledModals,
  closeScheduledListModal,
  loadScheduledMessages,
} from './chat/scheduled-messages.js'
import { bindAiAssistant, refreshAiAvailability } from './chat/ai-assistant.js'

// -----------------------------------------------------------------------------
// Re-exports (публичное API мессенджера для app.js / search.js)
// -----------------------------------------------------------------------------

export { closeScheduledListModal } from './chat/scheduled-messages.js'

export {
  autosizeTextarea,
  clearPendingMedia,
  closeComposerPopovers,
  handleComposerInput,
  onInputTyping,
  scheduleDraftSave,
  sendMessage,
  syncTtlSelectLabels,
  updateReplyPreview,
  updateSendButtonState,
} from './chat/composer.js'
export { closeContextMenus } from './chat/context-menu.js'
export {
  closeCreateRoomModal,
  closeCurrentChat,
  closePinnedListModal,
  bindUserDirectoryUi,
  hidePrivateUserSuggest,
  openChat,
  openCreateRoomModal,
  refreshMessengerHeader,
  submitCreateRoom,
  syncMobileMessengerLayout,
} from './chat/rooms.js'

// -----------------------------------------------------------------------------
// Модуль-локальное состояние фасада
// -----------------------------------------------------------------------------

let socketAppErrorListenerBound = false
let messagesRefreshListenerBound = false
let visibilityListenerBound = false

// -----------------------------------------------------------------------------
// Биндинги UI, не принадлежащие ни одной подсистеме эксклюзивно
// -----------------------------------------------------------------------------

function bindMessageComposerApple() {
  const el = els.messageInput
  if (!el || el.dataset.appleComposerBound === '1') return
  el.dataset.appleComposerBound = '1'
  el.addEventListener('paste', (e) => onPasteInsertPlainText(e, handleComposerInput))
}

function bindLocalSearch() {
  if (!els.btnChatLocalSearch || !els.localSearchPanel) return
  els.btnChatLocalSearch.addEventListener('click', () => {
    els.localSearchPanel.hidden = !els.localSearchPanel.hidden
    if (!els.localSearchPanel.hidden) els.localSearchInput?.focus()
  })
  if (!els.localSearchInput || !els.localSearchResults) return
  let tmr = null
  els.localSearchInput.addEventListener('input', () => {
    clearTimeout(tmr)
    tmr = setTimeout(async () => {
      const q = els.localSearchInput.value.trim()
      if (!q || !state.currentRoom) {
        els.localSearchResults.innerHTML = ''
        return
      }
      const data = await api.searchRoom(getUsername(), state.currentRoom, q, getToken())
      const rows = data.results || []
      els.localSearchResults.innerHTML = ''
      if (!rows.length) {
        const empty = document.createElement('div')
        empty.className = 'local-search-empty'
        empty.textContent = t('noSearchResults')
        els.localSearchResults.appendChild(empty)
        return
      }
      rows.forEach((row) => {
        const a = document.createElement('button')
        a.type = 'button'
        a.className = 'local-search-hit'
        const meta = document.createElement('span')
        meta.className = 'local-search-hit-meta'
        meta.textContent = row.username || ''
        const text = document.createElement('span')
        text.className = 'local-search-hit-text'
        fillElementWithAppleEmoji(text, (row.text || '').slice(0, 220))
        a.appendChild(meta)
        a.appendChild(text)
        a.addEventListener('click', () => {
          scrollToMessageById(row.id)
        })
        els.localSearchResults.appendChild(a)
      })
    }, 320)
  })
}

function bindDnd() {
  if (!els.btnChatDnd) return
  els.btnChatDnd.addEventListener('click', async () => {
    if (!state.currentRoom) return
    const room = state.currentRoom
    const next = !state.mutedRooms.has(room)
    const r = await api.setChatMute(getUsername(), room, next, getToken())
    if (r.success) {
      await refreshMutedRooms()
      await syncDndButton()
      showChatHeaderNotice(next ? t('chatDndOn') : t('chatDndOff'), 'info')
    }
  })
}

function bindTtlTrigger() {
  if (!els.ttlSelect || !els.ttlSelectTrigger || !els.ttlPopover) return
  rebuildTtlPopover()
  syncTtlDisplay()
  syncTtlSelectLabels()
  els.ttlSelect.addEventListener('change', () => {
    syncTtlDisplay()
    updateTtlActiveInPopover()
  })
  els.ttlSelectTrigger.addEventListener('click', (e) => {
    e.stopPropagation()
    if (!els.ttlPopover.hidden && els.ttlPopover.classList.contains('composer-float--open')) {
      return
    }
    closeCtxMenuAndEmoji()
    rebuildTtlPopover()
    positionComposerFloat(els.ttlPopover, els.composerTtlWrap || els.ttlSelectTrigger, 'ttl')
    els.ttlSelectTrigger.setAttribute('aria-expanded', 'true')
  })
}

function bindScheduleTrigger() {
  if (!els.btnScheduleSend || !els.schedulePopover || !els.scheduleDatetimeInput) return
  els.btnScheduleSend.addEventListener('click', (e) => {
    e.stopPropagation()
    if (!state.currentRoom) return
    if (!els.schedulePopover.hidden && els.schedulePopover.classList.contains('composer-float--open')) {
      return
    }
    closeCtxMenuAndEmoji()
    const minD = new Date()
    minD.setMinutes(minD.getMinutes() - 1)
    const pad = (n) => String(n).padStart(2, '0')
    els.scheduleDatetimeInput.min = `${minD.getFullYear()}-${pad(minD.getMonth() + 1)}-${pad(minD.getDate())}T${pad(minD.getHours())}:${pad(minD.getMinutes())}`
    els.scheduleDatetimeInput.value = defaultScheduleLocalValue()
    positionComposerFloat(els.schedulePopover, els.btnScheduleSend, 'schedule')
  })
  els.scheduleCancel?.addEventListener('click', (e) => {
    e.stopPropagation()
    closeComposerPopovers()
  })
  els.scheduleConfirm?.addEventListener('click', async (e) => {
    e.stopPropagation()
    const raw = els.scheduleDatetimeInput?.value
    if (!raw || !state.currentRoom) return
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) {
      showToast(t('schedulePrompt'), 'error')
      return
    }
    const text = plainTextFromComposerRoot(els.messageInput).trim()
    const r = await api.scheduleMessage(
      { room_id: state.currentRoom, text, scheduled_at: d.toISOString() },
      getToken(),
    )
    if (r.success) {
      showToast(t('scheduledOk'), 'success')
      setComposerPlainText(els.messageInput, '')
      updateSendButtonState()
      closeComposerPopovers()
      await loadScheduledMessages()
    } else showToast(translateApiMessage(r.message) || t('genericError'), 'error')
  })
}

function bindVoiceRecorder() {
  if (!els.btnVoiceRecord) return
  let mediaRecorder = null
  let chunks = []
  let voiceBusy = false
  const maxMs = 5 * 60 * 1000
  els.btnVoiceRecord.addEventListener('click', async () => {
    if (voiceBusy) return
    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.stop()
      return
    }
    if (!state.currentRoom) {
      showToast(t('selectChat'), 'error')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast(t('voiceNoMic'), 'error')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunks = []
      mediaRecorder = new MediaRecorder(stream)
      let recStart = 0
      mediaRecorder.onstart = () => {
        recStart = Date.now()
      }
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data)
      }
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop())
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' })
        if (!blob.size) return
        const file = new File([blob], 'voice.webm', { type: blob.type })
        voiceBusy = true
        els.btnVoiceRecord.classList.add('is-uploading')
        try {
          const up = await api.uploadMedia(file, 'voice', getToken())
          const durSec = Math.max(1, Math.round((Date.now() - recStart) / 1000))
          if (up.success && up.path) {
            await sendMessage({
              text: '',
              media: {
                type: 'voice',
                data: up.path,
                name: file.name,
                meta: { durationSec: Math.min(durSec, 300) },
              },
            })
          } else {
            showToast(translateApiMessage(up.message) || t('uploadFailed'), 'error')
          }
        } finally {
          voiceBusy = false
          els.btnVoiceRecord.classList.remove('is-uploading')
        }
      }
      mediaRecorder.start()
      els.btnVoiceRecord.classList.add('is-recording')
      setTimeout(() => {
        if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
      }, maxMs)
      mediaRecorder.addEventListener('stop', () => {
        els.btnVoiceRecord.classList.remove('is-recording')
      })
    } catch {
      showToast(t('voiceNoMic'), 'error')
    }
  })
}

function bindScrollPerfHints() {
  const scrollers = [els.messagesContainer, els.inboxList].filter(Boolean)
  if (!scrollers.length) return
  if (document.body.dataset.scrollPerfBound === '1') return
  document.body.dataset.scrollPerfBound = '1'

  let t = null
  const mark = () => {
    document.body.classList.add('is-chat-scrolling')
    clearTimeout(t)
    t = setTimeout(() => {
      document.body.classList.remove('is-chat-scrolling')
    }, 140)
  }
  scrollers.forEach((el) => el.addEventListener('scroll', mark, { passive: true }))
  window.addEventListener('blur', () => document.body.classList.remove('is-chat-scrolling'))
}

export function bindMessengerExtras() {
  bindMessageComposerApple()
  els.btnChatBack?.addEventListener('click', () => closeCurrentChat())
  let resizeLayoutTimer = null
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeLayoutTimer)
    resizeLayoutTimer = window.setTimeout(() => syncMobileMessengerLayout(), 100)
  })

  bindDnd()
  bindLocalSearch()
  bindTtlTrigger()
  bindScheduleTrigger()
  bindVoiceRecorder()
  bindDeleteMessageModal()
  bindReportMessageModal()
  bindEditMessageModal()
  bindPinnedListModal()
  bindScheduledMessageModals()
  bindAiAssistant()
  bindMessagesHistoryScroll()
  bindScrollPerfHints()
  if (!messagesRefreshListenerBound) {
    messagesRefreshListenerBound = true
    window.addEventListener('nebula-messages-refresh', (e) => {
      const detail = e.detail || {}
      renderMessages({
        scrollMode: detail.scrollMode || 'none',
        forceRebuildIds: detail.forceRebuildIds,
      })
    })
  }
}

// -----------------------------------------------------------------------------
// Сброс состояния при выходе
// -----------------------------------------------------------------------------

/** Сброс открытого чата и связанного состояния при выходе / смене сессии. */
export function resetMessengerAfterLogout() {
  closeMediaViewer()
  hidePrivateUserSuggest()
  clearPendingDeleteMessage()
  clearPendingEditMessage()
  clearPendingMedia()
  if (els.modalDeleteMessage && !els.modalDeleteMessage.hidden) {
    closeSmoothModal(els.modalDeleteMessage)
  }
  if (els.modalReportMessage && !els.modalReportMessage.hidden) {
    closeReportMessageModal()
  }
  if (els.modalEditMessage && !els.modalEditMessage.hidden) {
    closeSmoothModal(els.modalEditMessage)
  }
  clearPendingScheduledModals()
  if (els.modalEditScheduled && !els.modalEditScheduled.hidden) {
    closeSmoothModal(els.modalEditScheduled)
  }
  if (els.modalDeleteScheduled && !els.modalDeleteScheduled.hidden) {
    closeSmoothModal(els.modalDeleteScheduled)
  }
  closeScheduledListModal()
  closePinnedListModal()
  closeCurrentChat()
  state.rooms = []
  state.mutedRooms = new Set()
  if (els.globalSearch) els.globalSearch.value = ''
  if (els.searchResults) {
    hideSidebarDropdown(els.searchResults, { clear: true })
  }
}

// -----------------------------------------------------------------------------
// Bootstrap
// -----------------------------------------------------------------------------

export async function bootstrapMessenger(applyThemeToBody, applyLocaleToSettings) {
  state.messengerBootstrapped = true
  state.privateChatsMeta = []
  if (!socketAppErrorListenerBound) {
    socketAppErrorListenerBound = true
    window.addEventListener('nebula-socket-app-error', onSocketAppError)
  }
  window.addEventListener('nebula-locale', () => {
    rebuildTtlPopover()
    syncTtlDisplay()
    syncTtlSelectLabels()
  })
  await syncRoleFromServer()
  connectSocket()
  bindSocketEvents()
  bindMessengerExtras()
  syncExpiryWatcher()
  await refreshMutedRooms()
  refreshMessengerHeader()
  void refreshSidebarProfileLabel()
  applyThemeToBody()
  applyLocaleToSettings()
  syncTtlSelectLabels()
  syncMobileMessengerLayout()
  void refreshAiAvailability()
  loadRooms()
    .then(() => refreshBlockedSet())
    .then(() => loadUsersOnline())
    .then(() => refreshInbox())
  if (!visibilityListenerBound) {
    visibilityListenerBound = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !state.messengerBootstrapped) return
      void loadUsersOnline()
      scheduleInboxRefresh()
    })
  }
  if (!state.usersPollTimer) {
    state.usersPollTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      loadUsersOnline().then(() => scheduleInboxRefresh())
    }, 45000)
  }
  updateChatPanelVisibility()
  updateSendButtonState()
  syncMobileMessengerLayout()
}

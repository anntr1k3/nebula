/**
 * Отложенные сообщения: загрузка, модальное окно списка, редактирование и удаление.
 */

import * as api from '../api.js'
import { getToken } from '../auth.js'
import { t, translateApiMessage } from '../i18n.js'
import { els, state, showToast } from '../app-shell.js'
import { fillElementWithAppleEmoji } from '../emoji-apple.js'
import { openSmoothModal, closeSmoothModal } from '../modal-smooth.js'
import { normalizeScheduledMessage } from '../message-model.js'

let pendingEditScheduled = null
let pendingDeleteScheduled = null
let scheduledListModalPreviousFocus = null

export async function loadScheduledMessages() {
  if (!state.currentRoom) {
    state.scheduledMessages = []
    syncScheduledHeaderUi()
    return
  }
  const room = state.currentRoom
  const token = getToken()
  try {
    const data = await api.getScheduledMessages(room, token)
    if (state.currentRoom !== room) return
    const raw = data.messages || []
    state.scheduledMessages = raw.map(normalizeScheduledMessage)
  } catch {
    if (state.currentRoom === room) state.scheduledMessages = []
  }
  syncScheduledHeaderUi()
  if (els.modalScheduledList && !els.modalScheduledList.hidden) {
    renderScheduledListModal()
  }
}

export function clearScheduledMessages() {
  state.scheduledMessages = []
  syncScheduledHeaderUi()
}

export function syncScheduledHeaderUi() {
  const count = (state.scheduledMessages || []).length
  if (els.btnChatScheduled) {
    els.btnChatScheduled.hidden = !state.currentRoom
    els.btnChatScheduled.classList.toggle('has-scheduled', count > 0)
  }
  if (els.chatScheduledCount) {
    els.chatScheduledCount.hidden = count === 0
    els.chatScheduledCount.textContent = count > 0 ? String(count) : ''
  }
}

function scheduledAtToLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatScheduledBadge(iso) {
  if (!iso) return t('scheduledBadge')
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return t('scheduledBadge')
  const when = d.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  return t('scheduledBadgeAt').replace('{when}', when)
}

function formatScheduledListWhen(iso) {
  if (!iso) return t('scheduledBadge')
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return t('scheduledBadge')
  return d.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function renderScheduledListModal() {
  const list = els.scheduledList
  const empty = els.scheduledListEmpty
  if (!list) return

  const items = [...(state.scheduledMessages || [])].sort((a, b) => {
    const ta = Date.parse(a.scheduled_at || '') || 0
    const tb = Date.parse(b.scheduled_at || '') || 0
    return ta - tb
  })

  list.innerHTML = ''

  if (!items.length) {
    if (empty) empty.hidden = false
    return
  }

  if (empty) empty.hidden = true

  items.forEach((msg) => {
    const row = document.createElement('div')
    row.className = 'scheduled-list-item'
    row.setAttribute('role', 'listitem')

    const main = document.createElement('div')
    main.className = 'scheduled-list-item-main'

    const when = document.createElement('div')
    when.className = 'scheduled-list-item-when'
    when.innerHTML = `<i class="fa-solid fa-clock" aria-hidden="true"></i> ${formatScheduledListWhen(msg.scheduled_at)}`

    const text = document.createElement('div')
    text.className = 'scheduled-list-item-text'
    fillElementWithAppleEmoji(text, msg.text || '')

    main.appendChild(when)
    main.appendChild(text)

    const actions = document.createElement('div')
    actions.className = 'scheduled-list-item-actions'

    const editBtn = document.createElement('button')
    editBtn.type = 'button'
    editBtn.className = 'glass-button-small icon-only-btn'
    editBtn.setAttribute('aria-label', t('editMessage'))
    editBtn.title = t('editMessage')
    editBtn.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i>'
    editBtn.addEventListener('click', () => openEditScheduledModal(msg))

    const deleteBtn = document.createElement('button')
    deleteBtn.type = 'button'
    deleteBtn.className = 'glass-button-small icon-only-btn scheduled-list-delete'
    deleteBtn.setAttribute('aria-label', t('deleteMessage'))
    deleteBtn.title = t('deleteMessage')
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>'
    deleteBtn.addEventListener('click', () => openDeleteScheduledModal(msg))

    actions.appendChild(editBtn)
    actions.appendChild(deleteBtn)

    row.appendChild(main)
    row.appendChild(actions)
    list.appendChild(row)
  })
}

export function openScheduledListModal() {
  if (!els.modalScheduledList) return
  renderScheduledListModal()
  scheduledListModalPreviousFocus = document.activeElement
  openSmoothModal(els.modalScheduledList)
}

export function closeScheduledListModal() {
  if (!els.modalScheduledList) return
  closeSmoothModal(els.modalScheduledList)
  const prev = scheduledListModalPreviousFocus
  scheduledListModalPreviousFocus = null
  prev?.focus?.()
}

export function openEditScheduledModal(msg) {
  if (!msg?.is_scheduled || !els.modalEditScheduled) return
  pendingEditScheduled = msg
  if (els.editScheduledInput) els.editScheduledInput.value = msg.text || ''
  if (els.editScheduledDatetime) {
    const minD = new Date()
    minD.setMinutes(minD.getMinutes() - 1)
    const pad = (n) => String(n).padStart(2, '0')
    els.editScheduledDatetime.min = `${minD.getFullYear()}-${pad(minD.getMonth() + 1)}-${pad(minD.getDate())}T${pad(minD.getHours())}:${pad(minD.getMinutes())}`
    els.editScheduledDatetime.value = scheduledAtToLocalInput(msg.scheduled_at)
  }
  openSmoothModal(els.modalEditScheduled)
  els.editScheduledInput?.focus()
}

export function openDeleteScheduledModal(msg) {
  if (!msg?.is_scheduled) return
  pendingDeleteScheduled = msg
  openSmoothModal(els.modalDeleteScheduled)
}

export function clearPendingScheduledModals() {
  pendingEditScheduled = null
  pendingDeleteScheduled = null
}

export function bindScheduledMessageModals() {
  if (els.btnChatScheduled && els.btnChatScheduled.dataset.bound !== '1') {
    els.btnChatScheduled.dataset.bound = '1'
    els.btnChatScheduled.addEventListener('click', () => openScheduledListModal())
  }

  if (els.modalScheduledList?.dataset.scheduledListBound !== '1') {
    els.modalScheduledList.dataset.scheduledListBound = '1'
    els.btnScheduledListClose?.addEventListener('click', closeScheduledListModal)
    els.modalScheduledList.addEventListener('click', (e) => {
      if (e.target === els.modalScheduledList) closeScheduledListModal()
    })
  }

  if (els.modalEditScheduled?.dataset.scheduledEditBound === '1') return
  if (els.modalEditScheduled) els.modalEditScheduled.dataset.scheduledEditBound = '1'

  els.btnEditScheduledCancel?.addEventListener('click', () => {
    pendingEditScheduled = null
    closeSmoothModal(els.modalEditScheduled)
  })
  els.modalEditScheduled?.addEventListener('click', (e) => {
    if (e.target === els.modalEditScheduled) {
      pendingEditScheduled = null
      closeSmoothModal(els.modalEditScheduled)
    }
  })
  els.btnEditScheduledConfirm?.addEventListener('click', async () => {
    const msg = pendingEditScheduled
    if (!msg?.scheduled_id) return
    const text = (els.editScheduledInput?.value || '').trim()
    const raw = els.editScheduledDatetime?.value
    if (!text) {
      showToast(t('editMessageEmpty'), 'error')
      return
    }
    if (!raw) {
      showToast(t('schedulePrompt'), 'error')
      return
    }
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) {
      showToast(t('schedulePrompt'), 'error')
      return
    }
    const r = await api.updateScheduledMessage(
      msg.scheduled_id,
      { text, scheduled_at: d.toISOString() },
      getToken(),
    )
    if (r.success && r.message) {
      pendingEditScheduled = null
      closeSmoothModal(els.modalEditScheduled)
      const idx = state.scheduledMessages.findIndex(
        (m) => m.scheduled_id === msg.scheduled_id,
      )
      if (idx >= 0) {
        state.scheduledMessages[idx] = normalizeScheduledMessage(r.message)
      }
      syncScheduledHeaderUi()
      renderScheduledListModal()
      showToast(t('scheduledUpdated'), 'success')
    } else {
      showToast(translateApiMessage(r.message) || t('genericError'), 'error')
    }
  })

  if (els.modalDeleteScheduled?.dataset.scheduledDeleteBound === '1') return
  if (els.modalDeleteScheduled) els.modalDeleteScheduled.dataset.scheduledDeleteBound = '1'

  els.btnDeleteScheduledConfirm?.addEventListener('click', async () => {
    const msg = pendingDeleteScheduled
    pendingDeleteScheduled = null
    closeSmoothModal(els.modalDeleteScheduled)
    if (!msg?.scheduled_id) return
    const r = await api.deleteScheduledMessage(msg.scheduled_id, getToken())
    if (r.success) {
      state.scheduledMessages = state.scheduledMessages.filter(
        (m) => m.scheduled_id !== msg.scheduled_id,
      )
      syncScheduledHeaderUi()
      renderScheduledListModal()
      showToast(t('scheduledDeleted'), 'success')
    } else {
      showToast(translateApiMessage(r.message) || t('genericError'), 'error')
    }
  })
  els.btnDeleteScheduledCancel?.addEventListener('click', () => {
    pendingDeleteScheduled = null
    closeSmoothModal(els.modalDeleteScheduled)
  })
  els.modalDeleteScheduled?.addEventListener('click', (e) => {
    if (e.target === els.modalDeleteScheduled) {
      pendingDeleteScheduled = null
      closeSmoothModal(els.modalDeleteScheduled)
    }
  })
}

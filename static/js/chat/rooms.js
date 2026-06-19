/**
 * Управление комнатами мессенджера:
 *   - открытие/закрытие чата, загрузка истории, видимость мобильной раскладки;
 *   - список комнат, онлайн-карта пользователей;
 *   - модалка создания группы, выбор участников;
 *   - автодополнение для нового приватного чата, запуск приватной комнаты;
 *   - закреплённые сообщения: рендер пин-бара;
 *   - mute-режим (DND) для чата;
 *   - обновление «шапки» мессенджера.
 */

import * as api from '../api.js'
import { getToken, getUsername, isModerator } from '../auth.js'
import { t, translateApiMessage } from '../i18n.js'
import { getSocket } from '../socket.js'
import { els, hideChatHeaderNotice, state, showToast } from '../app-shell.js'
import { $ } from '../dom.js'
import {
  addPrivateChat,
  currentChatTitle,
  scheduleInboxRefresh,
} from '../inbox.js'
import { markRoomReadNow } from '../read-maps.js'
import { normalizeMessage, privatePeer } from '../message-model.js'
import { fillElementWithAppleEmoji, setComposerPlainText } from '../emoji-apple.js'
import { openSmoothModal, closeSmoothModal } from '../modal-smooth.js'
import { decryptMessagesForRoom, syncE2eeButton } from '../e2ee.js'
import {
  getSidebarDropdownBody,
  hideSidebarDropdown,
  revealSidebarDropdown,
} from '../sidebar-dropdown.js'
import {
  MEMBER_FILTER_DEBOUNCE_MS,
  PRIVATE_SUGGEST_DEBOUNCE_MS,
} from './constants.js'
import {
  mergeHistoryWithExisting,
  markVisibleAsRead,
  renderMessages,
} from './messages-render.js'
import {
  clearScheduledMessages,
  closeScheduledListModal,
  loadScheduledMessages,
  syncScheduledHeaderUi,
} from './scheduled-messages.js'
import { scrollToMessageById, syncExpiryWatcher } from './messages-animations.js'
import {
  autosizeTextarea,
  clearPendingMedia,
  emitStopTyping,
  loadDraftForCurrentRoom,
  updateReplyPreview,
  updateSendButtonState,
} from './composer.js'

let createRoomModalPreviousFocus = null
let privateSuggestTimer = null
let privateSuggestList = []
let privateSuggestIdx = -1
let groupDirectoryUsers = []
let memberFilterTimer = null

const MESSAGE_PAGE_SIZE = 50

function getOldestMessageId() {
  if (!state.messages.length) return null
  let oldest = state.messages[0]
  let oldestTs = Date.parse(oldest.timestamp || '') || 0
  for (const m of state.messages) {
    const ts = Date.parse(m.timestamp || '') || 0
    if (ts < oldestTs) {
      oldest = m
      oldestTs = ts
    }
  }
  return oldest.message_id
}

export function syncMessagesLoadOlderUi() {
  const el = els.messagesLoadOlder
  if (!el) return
  el.hidden = !(state.loadingOlderMessages && state.currentRoom)
}

export function bindMessagesHistoryScroll() {
  const container = els.messagesContainer
  if (!container || container.dataset.historyScrollBound === '1') return
  container.dataset.historyScrollBound = '1'
  container.addEventListener(
    'scroll',
    () => {
      if (container.scrollTop > 100) return
      if (!state.currentRoom || !state.messagesHasMore || state.loadingOlderMessages) return
      void loadOlderMessages()
    },
    { passive: true },
  )
}

export async function loadOlderMessages() {
  if (!state.currentRoom || state.loadingOlderMessages || !state.messagesHasMore) return
  const beforeId = getOldestMessageId()
  if (!beforeId) {
    state.messagesHasMore = false
    return
  }
  const room = state.currentRoom
  state.loadingOlderMessages = true
  syncMessagesLoadOlderUi()
  try {
    const data = await api.getMessages(room, getToken(), beforeId, MESSAGE_PAGE_SIZE)
    if (state.currentRoom !== room) return
    const fetched = await decryptMessagesForRoom(
      (data.messages || []).map(normalizeMessage),
      room,
    )
    if (!fetched.length) {
      state.messagesHasMore = false
      return
    }
    state.messages = mergeHistoryWithExisting(fetched, state.messages)
    state.messagesHasMore = !!data.has_more
    renderMessages({ scrollMode: 'preserve' })
  } catch {
    if (state.currentRoom === room) showToast(t('loadOlderFailed'), 'error')
  } finally {
    if (state.currentRoom === room) {
      state.loadingOlderMessages = false
      syncMessagesLoadOlderUi()
    }
  }
}
/** Выбранные участники группы (не только видимые в отфильтрованном списке). */
let membersSelection = new Set()

// -----------------------------------------------------------------------------
// Chat panel / mobile layout
// -----------------------------------------------------------------------------

export function updateChatPanelVisibility() {
  const has = !!state.currentRoom
  els.noChat.hidden = has
  els.chatPanel.hidden = !has
  if (!has && els.chatHeaderActions) els.chatHeaderActions.hidden = true
}

/** Узкая ширина: список чатов и открытый чат показываются по очереди (не две колонки). */
export function syncMobileMessengerLayout() {
  const vm = els.viewMessenger
  if (!vm?.classList.contains('nebula-shell')) return
  let mobile = false
  try {
    mobile = window.matchMedia('(max-width: 720px)').matches
  } catch {
    mobile = window.innerWidth <= 720
  }
  vm.classList.toggle('mobile-chat-active', mobile && !!state.currentRoom)
}

// -----------------------------------------------------------------------------
// Mute / DND
// -----------------------------------------------------------------------------

export async function refreshMutedRooms() {
  const token = getToken()
  const uname = getUsername()
  if (!token || !uname) return
  try {
    const d = await api.getMutedRooms(uname, token)
    state.mutedRooms = new Set(d.muted_rooms || [])
  } catch {
    state.mutedRooms = new Set()
  }
}

export async function syncDndButton() {
  if (!els.btnChatDnd || !state.currentRoom) return
  await refreshMutedRooms()
  const on = state.mutedRooms.has(state.currentRoom)
  els.btnChatDnd.classList.toggle('is-active', on)
  els.btnChatDnd.setAttribute('aria-pressed', on ? 'true' : 'false')
}

// -----------------------------------------------------------------------------
// Pinned strip + modal list
// -----------------------------------------------------------------------------

let currentPinnedMessages = []
let pinnedModalPreviousFocus = null

export function isMessagePinned(messageId) {
  const id = String(messageId || '')
  if (!id) return false
  return currentPinnedMessages.some((p) => String(p.message_id) === id)
}

function pinnedPreviewText(p) {
  return (p.text || p.media_type || '').replace(/\s+/g, ' ').trim().slice(0, 160)
}

function attachUnpinControl(row, p) {
  const unpin = document.createElement('span')
  unpin.className = 'pinned-unpin'
  unpin.setAttribute('role', 'button')
  unpin.setAttribute('tabindex', '0')
  unpin.setAttribute('aria-label', t('unpinMessage'))
  unpin.title = t('unpinMessage')
  const unpinIcon = document.createElement('i')
  unpinIcon.className = 'fa-solid fa-xmark'
  unpinIcon.setAttribute('aria-hidden', 'true')
  unpin.appendChild(unpinIcon)

  const doUnpin = (e) => {
    e.stopPropagation()
    e.preventDefault()
    getSocket()?.emit('unpin_message', {
      room_id: state.currentRoom,
      message_id: p.message_id,
      username: getUsername(),
    })
  }
  unpin.addEventListener('click', doUnpin)
  unpin.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') doUnpin(e)
  })
  row.appendChild(unpin)
}

function createPinnedRow(p, { inModal = false, totalCount = 1 } = {}) {
  const row = document.createElement('div')
  row.className = inModal ? 'pinned-item pinned-item--modal' : 'pinned-item'
  if (inModal) row.setAttribute('role', 'listitem')
  row.dataset.messageId = String(p.message_id)

  const label =
    totalCount > 1
      ? `${t('pinnedMessages')}: ${p.username || ''}`
      : t('pinnedGoToMessage')

  const go = document.createElement('button')
  go.type = 'button'
  go.className = 'pinned-item-go'
  go.setAttribute('aria-label', label)

  const pinIcon = document.createElement('i')
  pinIcon.className = 'fa-solid fa-thumbtack pinned-item-pin'
  pinIcon.setAttribute('aria-hidden', 'true')

  const body = document.createElement('span')
  body.className = 'pinned-item-body'

  const previewRow = document.createElement('span')
  previewRow.className = 'pinned-item-preview-row'

  const preview = document.createElement('span')
  preview.className = 'pinned-item-preview'
  fillElementWithAppleEmoji(preview, pinnedPreviewText(p))
  previewRow.appendChild(preview)

  const author = document.createElement('span')
  author.className = 'pinned-item-author'
  author.textContent = p.username || ''

  body.appendChild(previewRow)
  body.appendChild(author)

  go.appendChild(pinIcon)
  go.appendChild(body)
  go.addEventListener('click', () => {
    if (inModal) closePinnedListModal()
    scrollToMessageById(p.message_id)
  })

  row.appendChild(go)

  if (!inModal && totalCount > 1) {
    const countBtn = document.createElement('button')
    countBtn.type = 'button'
    countBtn.className = 'pinned-item-count pinned-item-count-btn'
    countBtn.textContent = String(totalCount)
    countBtn.setAttribute('aria-label', t('pinnedOpenList'))
    countBtn.title = t('pinnedOpenList')
    countBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      openPinnedListModal()
    })
    row.appendChild(countBtn)
  }

  attachUnpinControl(row, p)

  return row
}

function renderPinnedModalList() {
  const list = els.pinnedModalList
  if (!list) return
  list.innerHTML = ''
  currentPinnedMessages.forEach((p) => {
    list.appendChild(
      createPinnedRow(p, {
        inModal: true,
        totalCount: currentPinnedMessages.length,
      }),
    )
  })
}

export function openPinnedListModal() {
  if (currentPinnedMessages.length < 2) return
  renderPinnedModalList()
  pinnedModalPreviousFocus = document.activeElement
  openSmoothModal(els.modalPinnedList)
}

export function closePinnedListModal() {
  if (!els.modalPinnedList) return
  closeSmoothModal(els.modalPinnedList)
  const prev = pinnedModalPreviousFocus
  pinnedModalPreviousFocus = null
  prev?.focus?.()
}

export function bindPinnedListModal() {
  if (!els.modalPinnedList || els.modalPinnedList.dataset.bound === '1') return
  els.modalPinnedList.dataset.bound = '1'
  els.btnPinnedListClose?.addEventListener('click', closePinnedListModal)
  els.modalPinnedList.addEventListener('click', (e) => {
    if (e.target === els.modalPinnedList) closePinnedListModal()
  })
}

export async function loadPinnedStrip() {
  if (!state.currentRoom) return
  const room = state.currentRoom
  const token = getToken()
  const data = await api.getPinned(room, token)
  if (state.currentRoom !== room) return
  const pinned = await decryptMessagesForRoom(data.pinned || [], room)
  currentPinnedMessages = pinned

  if (!pinned.length) {
    els.pinnedStrip.hidden = true
    els.pinnedStrip.innerHTML = ''
    els.pinnedStrip.classList.remove('pinned-strip--many')
    if (els.modalPinnedList && !els.modalPinnedList.hidden) closePinnedListModal()
    return
  }

  els.pinnedStrip.hidden = false
  els.pinnedStrip.classList.toggle('pinned-strip--many', pinned.length > 1)

  const wrap = document.createElement('div')
  wrap.className = 'pinned-strip-inner'
  wrap.appendChild(
    createPinnedRow(pinned[0], { totalCount: pinned.length }),
  )

  els.pinnedStrip.innerHTML = ''
  els.pinnedStrip.appendChild(wrap)

  if (els.modalPinnedList && !els.modalPinnedList.hidden) {
    if (pinned.length < 2) closePinnedListModal()
    else renderPinnedModalList()
  }
}

// -----------------------------------------------------------------------------
// Открытие / закрытие чата и загрузка сообщений
// -----------------------------------------------------------------------------

export function openChat(roomId, type) {
  const chatPanelWasHidden = !!(els.chatPanel && els.chatPanel.hidden)
  if (state.currentRoom && state.currentRoom !== roomId) {
    clearPendingMedia()
    clearScheduledMessages()
  }
  state.currentRoom = roomId
  state.currentChatType = type
  if (type === 'private') {
    const peer = privatePeer(roomId, getUsername())
    if (peer) addPrivateChat(roomId, peer)
  }
  state.messages = []
  state.messagesHasMore = false
  state.loadingOlderMessages = false
  syncMessagesLoadOlderUi()
  syncE2eeButton()
  renderMessages({ forceScrollBottom: true })
  markRoomReadNow(roomId)
  const sock = getSocket()
  if (sock?.connected) {
    sock.emit('join', { room: roomId, username: getUsername() })
  } else {
    void loadMessages()
  }
  scheduleInboxRefresh()
  if (els.inboxList) {
    for (const node of els.inboxList.children) {
      if (node.dataset?.roomId) {
        node.classList.toggle('active', node.dataset.roomId === roomId)
      }
    }
  }
  updateChatPanelVisibility()
  /** Сначала раскладка (моб.): иначе панель внутри `.chat-area` с `display:none` не даёт анимации. */
  syncMobileMessengerLayout()
  if (chatPanelWasHidden && els.chatPanel) {
    const p = els.chatPanel
    p.classList.add('nebula-panel-enter')
    const onDone = () => {
      p.classList.remove('nebula-panel-enter')
    }
    p.addEventListener('animationend', onDone, { once: true })
    setTimeout(onDone, 800)
  }
  els.chatTitle.textContent = currentChatTitle()
  if (els.chatHeaderActions) els.chatHeaderActions.hidden = false
  if (els.localSearchPanel) els.localSearchPanel.hidden = true
  void loadDraftForCurrentRoom()
  void syncDndButton()
  loadPinnedStrip()
  void loadScheduledMessages().then(() => syncScheduledHeaderUi())
}

export function closeCurrentChat() {
  emitStopTyping()
  clearPendingMedia()
  clearScheduledMessages()
  closeScheduledListModal()
  closePinnedListModal()
  hideChatHeaderNotice()
  currentPinnedMessages = []
  state.currentRoom = null
  state.currentChatType = null
  state.messages = []
  state.messagesHasMore = false
  state.loadingOlderMessages = false
  syncMessagesLoadOlderUi()
  syncE2eeButton()
  state.replyTo = null
  if (els.messageInput) setComposerPlainText(els.messageInput, '')
  updateReplyPreview()
  renderMessages()
  updateChatPanelVisibility()
  if (els.chatTitle) els.chatTitle.textContent = ''
  if (els.chatHeaderActions) els.chatHeaderActions.hidden = true
  if (els.localSearchPanel) els.localSearchPanel.hidden = true
  if (els.pinnedStrip) {
    els.pinnedStrip.hidden = true
    els.pinnedStrip.innerHTML = ''
    els.pinnedStrip.classList.remove('pinned-strip--many')
  }
  if (els.typingBar) {
    els.typingBar.hidden = true
    els.typingBar.textContent = ''
  }
  updateSendButtonState()
  autosizeTextarea()
  scheduleInboxRefresh()
  if (els.inboxList) {
    for (const node of els.inboxList.children) {
      if (node.dataset?.roomId) node.classList.remove('active')
    }
  }
  syncMobileMessengerLayout()
  syncExpiryWatcher()
}

export async function loadMessages() {
  if (!state.currentRoom) return
  const room = state.currentRoom
  const token = getToken()
  const data = await api.getMessages(room, token, null, MESSAGE_PAGE_SIZE)
  if (state.currentRoom !== room) return
  const raw = data.messages || []
  const fetched = await decryptMessagesForRoom(raw.map(normalizeMessage), room)
  state.messages = mergeHistoryWithExisting(fetched, state.messages)
  state.messagesHasMore = !!data.has_more
  if (state.messages.length === 0) {
    state.replyTo = null
  }
  await loadScheduledMessages()
  if (state.currentRoom !== room) return
  syncScheduledHeaderUi()
  renderMessages({ forceScrollBottom: true })
  markVisibleAsRead()
  syncExpiryWatcher()
}

// -----------------------------------------------------------------------------
// Список комнат и онлайн-карта
// -----------------------------------------------------------------------------

export async function loadRooms() {
  const data = await api.getRooms(getUsername(), getToken())
  state.rooms = data.rooms || []
}

export async function loadUsersOnline() {
  try {
    const data = await api.getUsers(getUsername(), getToken())
    const map = {}
    const prof = {}
    ;(data.users || []).forEach((u) => {
      const name = u.username || u
      map[name] = !!u.online
      const at = String(u.avatarType || 'emoji').toLowerCase()
      prof[name] = {
        avatar: u.avatar != null && u.avatar !== '' ? u.avatar : '👤',
        avatarType: at === 'image' ? 'image' : 'emoji',
        nickname: u.nickname,
      }
    })
    state.onlineByUser = map
    state.userProfileCache = prof
  } catch {
    state.onlineByUser = {}
    state.userProfileCache = {}
  }
}

// -----------------------------------------------------------------------------
// Модалка «Создать группу»
// -----------------------------------------------------------------------------

function renderMembersList() {
  if (!els.membersList) return
  const filterRaw = els.membersSearch?.value ?? ''
  const filter = filterRaw.trim().toLowerCase()
  const users = groupDirectoryUsers.filter((u) => {
    const un = String(u.username || '').toLowerCase()
    const nn = String(u.nickname || '').toLowerCase()
    if (!filter) return false
    return un.includes(filter) || nn.includes(filter)
  })
  els.membersList.innerHTML = ''
  users.forEach((u) => {
    const username = u.username
    const label = document.createElement('label')
    label.className = 'member-checkbox'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.value = username
    if (membersSelection.has(username)) cb.checked = true
    cb.addEventListener('change', () => {
      if (cb.checked) membersSelection.add(username)
      else membersSelection.delete(username)
    })
    label.appendChild(cb)
    const nick = u.nickname && String(u.nickname).trim()
    const showNick = nick && nick.toLowerCase() !== String(username).toLowerCase()
    const text = showNick ? ` ${nick} (@${username})` : ` ${username}`
    label.appendChild(document.createTextNode(text))
    els.membersList.appendChild(label)
  })
}

async function loadUsersForModal() {
  const data = await api.getUsers(getUsername(), getToken())
  groupDirectoryUsers = (data.users || []).filter((u) => (u.username || u) !== getUsername())
  renderMembersList()
}

export function openCreateRoomModal() {
  createRoomModalPreviousFocus = document.activeElement
  openSmoothModal(els.modalCreate)
  $('#new-room-name').value = ''
  membersSelection = new Set()
  if (els.membersSearch) els.membersSearch.value = ''
  void loadUsersForModal()
  requestAnimationFrame(() => {
    const nameInput = $('#new-room-name')
    nameInput?.focus()
    nameInput?.select()
  })
}

export function closeCreateRoomModal() {
  closeSmoothModal(els.modalCreate)
  const prev = createRoomModalPreviousFocus
  createRoomModalPreviousFocus = null
  if (prev && typeof prev.focus === 'function') {
    try {
      prev.focus()
    } catch {
      /* ignore */
    }
  }
}

export async function submitCreateRoom() {
  const name = $('#new-room-name').value.trim()
  const selected = [...membersSelection]
  if (!name || selected.length === 0) return
  const data = await api.createRoom(name, selected, getUsername(), getToken())
  if (data.success) {
    closeCreateRoomModal()
    await loadRooms()
    scheduleInboxRefresh()
  } else {
    showToast(translateApiMessage(data.message) || t('requestFailed'), 'error')
  }
}

// -----------------------------------------------------------------------------
// Autocomplete приватного чата
// -----------------------------------------------------------------------------

export function hidePrivateUserSuggest() {
  privateSuggestIdx = -1
  privateSuggestList = []
  if (els.newChatSuggestions) {
    hideSidebarDropdown(els.newChatSuggestions, { clear: true })
  }
  if (els.newChatUser) {
    els.newChatUser.setAttribute('aria-expanded', 'false')
  }
}

function updatePrivateSuggestHighlight() {
  const body = getSidebarDropdownBody(els.newChatSuggestions)
  if (!body) return
  ;[...body.children].forEach((el, i) => {
    el.classList.toggle('is-active', i === privateSuggestIdx)
    el.setAttribute('aria-selected', i === privateSuggestIdx ? 'true' : 'false')
  })
}

function renderPrivateSuggest(users) {
  privateSuggestList = users
  privateSuggestIdx = users.length > 0 ? 0 : -1
  if (!els.newChatSuggestions || !els.newChatUser) return
  const body = getSidebarDropdownBody(els.newChatSuggestions)
  if (!body) return
  body.innerHTML = ''
  if (!users.length) {
    hidePrivateUserSuggest()
    return
  }
  users.forEach((u) => {
    const row = document.createElement('div')
    row.className = 'user-suggest-row'
    row.setAttribute('role', 'option')
    const d1 = document.createElement('div')
    d1.className = 'user-suggest-primary'
    const nick = u.nickname && String(u.nickname).trim()
    const showNick = nick && nick.toLowerCase() !== String(u.username).toLowerCase()
    d1.textContent = showNick ? nick : u.username
    const d2 = document.createElement('div')
    d2.className = 'user-suggest-meta'
    const on = u.online ? t('online') : t('offline')
    d2.textContent = showNick ? `@${u.username} · ${on}` : on
    row.appendChild(d1)
    row.appendChild(d2)
    row.addEventListener('mousedown', (e) => {
      e.preventDefault()
      startPrivateChat(u.username)
    })
    body.appendChild(row)
  })
  revealSidebarDropdown(els.newChatSuggestions)
  els.newChatUser.setAttribute('aria-expanded', 'true')
  updatePrivateSuggestHighlight()
}

async function fetchPrivateSuggest() {
  if (!els.newChatUser) return
  const q = els.newChatUser.value.trim()
  if (!q) {
    hidePrivateUserSuggest()
    return
  }
  try {
    const data = await api.getUsers(getUsername(), getToken(), { q, limit: 32 })
    const me = getUsername()
    const users = (data.users || []).filter((u) => (u.username || u) !== me)
    renderPrivateSuggest(users)
  } catch {
    hidePrivateUserSuggest()
  }
}

function schedulePrivateSuggestFetch() {
  clearTimeout(privateSuggestTimer)
  privateSuggestTimer = setTimeout(() => void fetchPrivateSuggest(), PRIVATE_SUGGEST_DEBOUNCE_MS)
}

/** Autocomplete for new private chat; filter members in create-group modal. */
export function bindUserDirectoryUi() {
  if (!els.newChatUser || !els.newChatSuggestions) return

  els.newChatUser.addEventListener('input', () => {
    schedulePrivateSuggestFetch()
  })
  els.newChatUser.addEventListener('focus', () => {
    if (els.newChatUser.value.trim()) schedulePrivateSuggestFetch()
  })
  els.newChatUser.addEventListener('blur', () => {
    setTimeout(() => hidePrivateUserSuggest(), 280)
  })
  els.newChatUser.addEventListener('keydown', (e) => {
    if (!els.newChatSuggestions || els.newChatSuggestions.hidden) {
      if (e.key === 'Enter') startPrivateChat()
      return
    }
    if (e.key === 'Escape') {
      hidePrivateUserSuggest()
      e.preventDefault()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (privateSuggestList.length) {
        privateSuggestIdx = Math.min(privateSuggestIdx + 1, privateSuggestList.length - 1)
        updatePrivateSuggestHighlight()
      }
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (privateSuggestList.length) {
        privateSuggestIdx = Math.max(privateSuggestIdx - 1, 0)
        updatePrivateSuggestHighlight()
      }
      return
    }
    if (e.key === 'Enter') {
      if (privateSuggestIdx >= 0 && privateSuggestList[privateSuggestIdx]) {
        e.preventDefault()
        startPrivateChat(privateSuggestList[privateSuggestIdx].username)
        return
      }
      startPrivateChat()
    }
  })

  if (els.membersSearch) {
    els.membersSearch.addEventListener('input', () => {
      clearTimeout(memberFilterTimer)
      memberFilterTimer = setTimeout(() => renderMembersList(), MEMBER_FILTER_DEBOUNCE_MS)
    })
  }

  document.addEventListener('click', (e) => {
    if (
      els.newChatSuggestions &&
      !els.newChatSuggestions.hidden &&
      e.target !== els.newChatUser &&
      !els.newChatUser.contains(e.target) &&
      !els.newChatSuggestions.contains(e.target)
    ) {
      hidePrivateUserSuggest()
    }
  })
}

export function startPrivateChat(resolvedUsername = null) {
  const raw =
    resolvedUsername != null
      ? String(resolvedUsername)
      : (els.newChatUser?.value ?? $('#new-chat-user').value)
  const name = raw.trim()
  const uname = getUsername()
  hidePrivateUserSuggest()
  if (!name || name === uname) return
  const roomId = `private_${[uname, name].sort().join('_')}`
  addPrivateChat(roomId, name)
  scheduleInboxRefresh()
  openChat(roomId, 'private')
  if (els.newChatUser) els.newChatUser.value = ''
}

// -----------------------------------------------------------------------------
// Шапка мессенджера
// -----------------------------------------------------------------------------

export function refreshMessengerHeader() {
  els.messengerUsername.textContent = getUsername() || ''
  els.btnAdmin.hidden = !isModerator()
  els.btnAttach.title = t('attachFile')
  els.btnAttach.setAttribute('aria-label', t('attachFile'))
}

/**
 * Подписка на Socket.IO-события сервера и синхронизация серверной роли.
 * Вся бизнес-логика делегируется в модули рендера/анимаций/композера/комнат.
 */

import * as api from '../api.js'
import { getToken, getUsername, markServerRoleConfirmed, setAuth } from '../auth.js'
import { getSocket } from '../socket.js'
import { els, state } from '../app-shell.js'
import { bumpUnread } from '../read-maps.js'
import { normalizeMessage } from '../message-model.js'
import { scheduleInboxRefresh } from '../inbox.js'
import {
  markVisibleAsRead,
  mergeHistoryWithExisting,
  patchMessageEdited,
  patchMessageReactions,
  patchMessageReadReceipt,
  renderMessages,
} from './messages-render.js'
import { animateMessagesLeaveAndRemove } from './messages-animations.js'
import { loadPinnedStrip, loadUsersOnline, syncMessagesLoadOlderUi } from './rooms.js'
import { loadScheduledMessages, syncScheduledHeaderUi } from './scheduled-messages.js'
import { syncExpiryWatcher } from './messages-animations.js'
import { setTypingIndicator } from './composer.js'

export function bindSocketEvents() {
  const sock = getSocket()
  if (!sock || sock._nebulaBound) return
  sock._nebulaBound = true

  /** После reconnect новый sid — без join сервер не шлёт receive_message в комнату группы. */
  sock.on('connect', () => {
    const room = state.currentRoom
    const uname = getUsername()
    if (!room || !uname || !sock.connected) return
    sock.emit('join', { room, username: uname })
  })

  sock.on('message_history', async (data) => {
    if (!data.messages) return
    if (data.room != null && data.room !== state.currentRoom) return
    const fetched = data.messages.map(normalizeMessage)
    state.messages = mergeHistoryWithExisting(fetched, state.messages)
    state.messagesHasMore = fetched.length >= 100
    await loadScheduledMessages()
    renderMessages()
    syncScheduledHeaderUi()
    markVisibleAsRead()
    syncExpiryWatcher()
    syncMessagesLoadOlderUi()
  })

  sock.on('receive_message', (msg) => {
    const norm = normalizeMessage(msg)
    const roomId = msg.room ?? msg.room_id
    const cur = state.currentRoom
    if (String(roomId || '') === String(cur || '')) {
      const nid = String(norm.message_id || '')
      if (nid && state.messages.some((x) => String(x.message_id) === nid)) return
      state.messages.push(norm)
      renderMessages(
        nid
          ? { playEnterMessageId: norm.message_id, forceScrollBottom: true }
          : { forceScrollBottom: true },
      )
      markVisibleAsRead()
      syncExpiryWatcher()
    } else {
      bumpUnread(roomId, state.currentRoom, state.mutedRooms)
    }
    scheduleInboxRefresh()
  })

  sock.on('reaction_updated', (data) => {
    if (!data || data.message_id == null) return
    const m = state.messages.find((x) => x.message_id === data.message_id)
    if (m) {
      m.reactions = data.reactions || {}
      if (!patchMessageReactions(m)) renderMessages()
    }
  })

  sock.on('message_read', (data) => {
    if (!data?.message_id) return
    const m = state.messages.find((x) => x.message_id === data.message_id)
    if (m) {
      m.read_by = data.read_by || m.read_by
      if (!patchMessageReadReceipt(m)) renderMessages()
    }
  })

  sock.on('message_read_batch', (data) => {
    if (data?.room != null && data.room !== state.currentRoom) return
    if (!Array.isArray(data?.reads)) return
    const byId = new Map(state.messages.map((m) => [String(m.message_id), m]))
    let needsRender = false
    data.reads.forEach((item) => {
      if (!item?.message_id) return
      const id = String(item.message_id)
      const m = byId.get(id)
      if (!m) return
      m.read_by = item.read_by || m.read_by
      if (!patchMessageReadReceipt(m)) needsRender = true
    })
    if (needsRender) renderMessages()
  })

  sock.on('message_edited', (data) => {
    const m = state.messages.find((x) => x.message_id === data.message_id)
    if (m) {
      m.text = data.new_text
      m.edited = true
      if (!patchMessageEdited(m)) renderMessages()
    }
    /** Если отредактированное сообщение — закреплённое, обновляем превью в пин-баре. */
    if (state.currentRoom && els.pinnedStrip && !els.pinnedStrip.hidden) {
      const id = String(data.message_id)
      const pinnedHit = els.pinnedStrip.querySelector(
        `.pinned-item[data-message-id="${CSS.escape(id)}"]`,
      )
      if (pinnedHit) loadPinnedStrip()
    }
  })

  sock.on('message_deleted', (data) => {
    if (data?.message_id == null) return
    if (data.room != null && data.room !== state.currentRoom) return
    const id = String(data.message_id)
    /** Если удалено закреплённое сообщение — БД каскадом отпинит его, обновим стрип. */
    if (els.pinnedStrip && !els.pinnedStrip.hidden) {
      const pinnedHit = els.pinnedStrip.querySelector(
        `.pinned-item[data-message-id="${CSS.escape(id)}"]`,
      )
      if (pinnedHit) loadPinnedStrip()
    }
    if (!state.messages.some((x) => String(x.message_id) === id)) return
    animateMessagesLeaveAndRemove([id])
  })

  sock.on('message_pinned', () => {
    if (state.currentRoom) loadPinnedStrip()
  })
  sock.on('message_unpinned', () => {
    if (state.currentRoom) loadPinnedStrip()
  })

  sock.on('user_typing', (data) => {
    if (data.room !== state.currentRoom || data.username === getUsername()) return
    setTypingIndicator([data.username])
  })
  sock.on('user_stop_typing', (data) => {
    if (data.room !== state.currentRoom) return
    setTypingIndicator([])
  })

  sock.on('user_status_changed', () => {
    loadUsersOnline().then(() => scheduleInboxRefresh())
  })

  sock.on('user_profile_updated', (data) => {
    if (!data?.username) return
    const u = data.username
    const at = String(data.avatarType || 'emoji').toLowerCase()
    state.userProfileCache[u] = {
      avatar: data.avatar != null && data.avatar !== '' ? data.avatar : '👤',
      avatarType: at === 'image' ? 'image' : 'emoji',
      nickname: data.nickname,
    }
    scheduleInboxRefresh()
  })
}

export async function syncRoleFromServer() {
  const token = getToken()
  const username = getUsername()
  if (!token || !username) return
  try {
    const me = await api.getMe(token)
    if (me.success) {
      setAuth({
        token,
        username: me.username || username,
        role: me.role,
      })
      markServerRoleConfirmed()
    }
  } catch {
    /* offline / error — keep cached role; кнопка модератора скрыта, пока сервер не подтвердил роль */
  }
}

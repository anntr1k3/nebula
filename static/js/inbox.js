import * as api from './api.js'
import { getToken, getUsername } from './auth.js'
import { t } from './i18n.js'
import { createAppleEmojiImg, fillElementWithAppleEmoji } from './emoji-apple.js'
import { els, showToast, state } from './app-shell.js'
import { fillUserAvatarElement } from './user-avatar.js'
import { readUnreadMap } from './read-maps.js'
import { privatePeer } from './message-model.js'

export function currentChatTitle() {
  if (!state.currentRoom) return ''
  const uname = getUsername()
  if (state.currentChatType === 'private') {
    const peer = privatePeer(state.currentRoom, uname)
    const meta = state.privateChatsMeta.find((c) => c.roomId === state.currentRoom)
    return meta?.name || peer || state.currentRoom
  }
  const room = state.rooms.find((r) => r.id === state.currentRoom)
  return room?.name || state.currentRoom
}

function enrichInboxItem(item) {
  const meta = state.privateChatsMeta.find((c) => c.roomId === item.room_id)
  const displayTitle =
    item.kind === 'private' && meta?.name ? meta.name : item.title || item.room_id
  return { ...item, displayTitle }
}

function mergeInboxRows(serverItems) {
  const serverIds = new Set(serverItems.map((i) => i.room_id))
  const me = getUsername()
  const extra = state.privateChatsMeta
    .filter((m) => {
      if (serverIds.has(m.roomId)) return false
      const peer = privatePeer(m.roomId, me)
      return !!peer
    })
    .map((m) => ({
      room_id: m.roomId,
      kind: 'private',
      title: m.name,
      last_preview: '',
      last_at: null,
    }))
  const enriched = [...serverItems.map(enrichInboxItem), ...extra.map(enrichInboxItem)]
  enriched.sort((a, b) => {
    const ta = a.last_at || ''
    const tb = b.last_at || ''
    if (ta && tb) return tb.localeCompare(ta)
    if (ta && !tb) return -1
    if (!ta && tb) return 1
    return (a.displayTitle || '').localeCompare(b.displayTitle || '')
  })
  return enriched
}

function formatInboxTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function fillInboxAvatar(av, row, me) {
  av.replaceChildren()
  const peer = row.kind === 'private' ? privatePeer(row.room_id, me) : null
  const fromProfile = peer && state.userProfileCache[peer]
  let done = false
  if (fromProfile) {
    fillUserAvatarElement(av, fromProfile.avatar, fromProfile.avatarType)
    done = true
  }
  if (!done) {
    const title = (row.displayTitle || row.title || '?').trim()
    if (title && typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        const first = [...segmenter.segment(title)][0]?.segment
        if (first && /\p{Extended_Pictographic}/u.test(first)) {
          const img = createAppleEmojiImg(first, 'inbox-avatar-emoji')
          img.loading = 'lazy'
          av.appendChild(img)
          done = true
        }
      } catch {
        /* fall through */
      }
    }
    if (!done) {
      const cp = title.codePointAt(0) || 63
      av.textContent = String.fromCodePoint(cp).toUpperCase()
    }
  }
  if (row.kind === 'private') {
    const p = privatePeer(row.room_id, me)
    if (p && state.onlineByUser[p]) {
      const dot = document.createElement('span')
      dot.className = 'inbox-online-dot'
      dot.title = t('online')
      av.appendChild(dot)
    }
  }
}

function createInboxRow(row, unreadMap, me) {
  const div = document.createElement('div')
  div.className = 'inbox-row'
  div.setAttribute('role', 'listitem')
  div.dataset.roomId = row.room_id
  div.dataset.chatType = row.kind === 'group' ? 'group' : 'private'

  const av = document.createElement('div')
  av.className = 'inbox-avatar'
  av.setAttribute('aria-hidden', 'true')
  fillInboxAvatar(av, row, me)

  const body = document.createElement('div')
  body.className = 'inbox-body'
  const top = document.createElement('div')
  top.className = 'inbox-top'
  const title = document.createElement('span')
  title.className = 'inbox-title'
  const time = document.createElement('span')
  time.className = 'inbox-time'
  top.appendChild(title)
  top.appendChild(time)

  const preview = document.createElement('div')
  preview.className = 'inbox-preview'
  body.appendChild(top)
  body.appendChild(preview)

  const badge = document.createElement('span')
  badge.className = 'inbox-badge'

  div.appendChild(av)
  div.appendChild(body)
  div.appendChild(badge)

  updateInboxRow(div, row, unreadMap, me)
  return div
}

function inboxAvatarCacheKey(row, me) {
  const peer = row.kind === 'private' ? privatePeer(row.room_id, me) : null
  if (!peer) return ''
  const p = state.userProfileCache[peer]
  if (!p) return `${peer}:`
  return `${peer}:${p.avatarType}:${p.avatar}`
}

function updateInboxRow(div, row, unreadMap, me) {
  div.dataset.chatType = row.kind === 'group' ? 'group' : 'private'
  div.classList.toggle('active', state.currentRoom === row.room_id)
  const n = unreadMap[row.room_id] || 0
  div.classList.toggle('unread', n > 0)

  const av = div.querySelector('.inbox-avatar')
  if (av) {
    const key = inboxAvatarCacheKey(row, me)
    if (av.dataset.avatarKey !== key) {
      av.dataset.avatarKey = key
      fillInboxAvatar(av, row, me)
    }
    const peer = row.kind === 'private' ? privatePeer(row.room_id, me) : null
    const wantDot = !!(peer && state.onlineByUser[peer])
    const dot = av.querySelector('.inbox-online-dot')
    if (wantDot && !dot) {
      const d = document.createElement('span')
      d.className = 'inbox-online-dot'
      d.title = t('online')
      av.appendChild(d)
    } else if (!wantDot && dot) {
      dot.remove()
    }
  }

  const titleEl = div.querySelector('.inbox-title')
  if (titleEl) titleEl.textContent = row.displayTitle || row.title

  const timeEl = div.querySelector('.inbox-time')
  if (timeEl) timeEl.textContent = formatInboxTime(row.last_at)

  const preview = div.querySelector('.inbox-preview')
  if (preview) {
    let prevText = row.last_preview || '—'
    if (row.has_draft) prevText = `[${t('draftLabel')}] ${prevText}`
    fillElementWithAppleEmoji(preview, prevText)
  }

  const badge = div.querySelector('.inbox-badge')
  if (badge) {
    if (n > 0) {
      badge.hidden = false
      badge.textContent = n > 99 ? '99+' : String(n)
    } else {
      badge.hidden = true
    }
  }
}

/** Сброс списка чатов в UI (выход из аккаунта и т.п.). */
export function clearInboxUi() {
  if (!els.inboxList) return
  renderInboxList([])
}

export function renderInboxList(rows) {
  if (!els.inboxList) return
  const unreadMap = readUnreadMap()
  const me = getUsername()
  const list = els.inboxList
  const byId = new Map()
  for (const node of list.children) {
    const id = node.dataset?.roomId
    if (id) byId.set(id, node)
  }

  const wantedIds = new Set(rows.map((r) => r.room_id))
  for (const [id, node] of byId) {
    if (!wantedIds.has(id)) node.remove()
  }

  rows.forEach((row, index) => {
    let rowEl = byId.get(row.room_id)
    if (!rowEl) {
      rowEl = createInboxRow(row, unreadMap, me)
      byId.set(row.room_id, rowEl)
    } else {
      updateInboxRow(rowEl, row, unreadMap, me)
    }
    const before = list.children[index]
    if (before !== rowEl) list.insertBefore(rowEl, before ?? null)
  })

  els.inboxEmpty.hidden = rows.length > 0
}

export async function refreshBlockedSet() {
  const token = getToken()
  const uname = getUsername()
  if (!token || !uname) {
    state.blockedSet = new Set()
    return
  }
  try {
    const d = await api.getBlocked(uname, token)
    state.blockedSet = new Set(d.blocked || [])
  } catch {
    state.blockedSet = new Set()
  }
}

export async function refreshInbox() {
  const token = getToken()
  const uname = getUsername()
  if (!token || !uname) return
  try {
    const data = await api.getInbox(uname, token)
    if (data && data.success === false) {
      // Do not wipe UI on throttling; keep last known inbox.
      if (data.status === 429) {
        const now = Date.now()
        if (!refreshInbox._last429 || now - refreshInbox._last429 > 4500) {
          refreshInbox._last429 = now
          showToast(t('socketRateLimit') || 'Слишком много запросов. Подождите немного…', 'error')
        }
        return
      }
      // Other non-OK responses: fall through to keep UI unchanged as well.
      return
    }
    const items = data.items || []
    const merged = mergeInboxRows(items)
    const filtered = merged.filter((row) => {
      if (row.kind !== 'private') return true
      const p = privatePeer(row.room_id, uname)
      if (!p) return false
      return !state.blockedSet.has(p)
    })
    renderInboxList(filtered)
  } catch {
    // Keep the last rendered inbox if request failed (network/offline/etc).
  }
}

export function scheduleInboxRefresh() {
  clearTimeout(state.inboxDebounce)
  state.inboxDebounce = setTimeout(() => refreshInbox(), 350)
}

export function addPrivateChat(roomId, displayName) {
  if (!state.privateChatsMeta.some((c) => c.roomId === roomId)) {
    state.privateChatsMeta.push({ roomId, name: displayName })
  }
}

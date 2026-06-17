const API_BASE = ''

function authHeaders(token, jsonBody = false) {
  const h = {}
  if (jsonBody) h['Content-Type'] = 'application/json'
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

function onSessionInvalid() {
  window.dispatchEvent(new CustomEvent('nebula-auth-lost'))
}

async function parseJsonResponse(res) {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

function normalizeHttpResult(res, data) {
  if (res.ok) return data
  if (res.status === 401) return data
  const base = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {}
  const msg =
    (typeof base.message === 'string' && base.message) ||
    (typeof base.error === 'string' && base.error) ||
    res.statusText ||
    'Bad Request'
  return {
    ...base,
    status: res.status,
    success: false,
    message: msg,
  }
}

async function apiPost(url, body = {}, token = null) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify(body),
  })
  const data = await parseJsonResponse(res)
  if (res.status === 401) onSessionInvalid()
  return normalizeHttpResult(res, data)
}

async function apiGet(url, token = null) {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: authHeaders(token, false),
  })
  const data = await parseJsonResponse(res)
  if (res.status === 401) onSessionInvalid()
  return normalizeHttpResult(res, data)
}

async function apiPatch(url, body = {}, token = null) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'PATCH',
    headers: authHeaders(token, true),
    body: JSON.stringify(body),
  })
  const data = await parseJsonResponse(res)
  if (res.status === 401) onSessionInvalid()
  return normalizeHttpResult(res, data)
}

async function apiDelete(url, token = null) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'DELETE',
    headers: authHeaders(token, false),
  })
  const data = await parseJsonResponse(res)
  if (res.status === 401) onSessionInvalid()
  return normalizeHttpResult(res, data)
}

export async function register(username, password) {
  return apiPost('/api/register', { username, password })
}

export async function login(username, password) {
  return apiPost('/api/login', { username, password })
}

export async function getUsers(currentUser, token, opts = {}) {
  let url = `/api/users?current_user=${encodeURIComponent(currentUser)}`
  if (opts.q != null && String(opts.q).trim() !== '') {
    url += `&q=${encodeURIComponent(String(opts.q).trim())}`
  }
  if (opts.limit != null) {
    url += `&limit=${encodeURIComponent(String(opts.limit))}`
  }
  return apiGet(url, token)
}

export async function getRooms(username, token) {
  return apiGet(`/api/rooms?username=${encodeURIComponent(username)}`, token)
}

export async function createRoom(name, members, creator, token) {
  return apiPost('/api/rooms', { name, members, creator }, token)
}

export async function getMe(token) {
  return apiGet('/api/me', token)
}

export async function getMessages(room, token, before = null, limit = 50) {
  let url = `/api/messages?room=${encodeURIComponent(room)}&limit=${limit}`
  if (before) url += `&before=${before}`
  return apiGet(url, token)
}

export async function getInbox(username, token) {
  return apiGet(`/api/inbox?username=${encodeURIComponent(username)}`, token)
}

export async function getPinned(roomId, token) {
  const enc = encodeURIComponent(roomId)
  return apiGet(`/api/pinned/${enc}`, token)
}

export async function getProfile(username, token) {
  return apiGet(`/api/profile/${encodeURIComponent(username)}`, token)
}

export async function updateProfile(
  { username, nickname, bio, avatar, avatarType },
  token,
) {
  return apiPost(
    '/api/profile',
    {
      username,
      nickname,
      bio,
      avatar,
      avatarType: avatarType || 'emoji',
    },
    token,
  )
}

export async function getBlocked(username, token) {
  return apiGet(`/api/blocked?username=${encodeURIComponent(username)}`, token)
}

export async function blockUser(username, blockUsername, token) {
  return apiPost('/api/block', { username, block_username: blockUsername }, token)
}

export async function unblockUser(username, unblockUsername, token) {
  return apiPost('/api/unblock', { username, unblock_username: unblockUsername }, token)
}

export async function searchGlobal(username, q, token, limit = 40, filters = {}) {
  const u = encodeURIComponent(username)
  const query = encodeURIComponent(q)
  let url = `/api/search_global?username=${u}&q=${query}&limit=${limit}`
  if (filters.room) url += `&room=${encodeURIComponent(filters.room)}`
  if (filters.author) url += `&author=${encodeURIComponent(filters.author)}`
  if (filters.media_kind) url += `&media_kind=${encodeURIComponent(filters.media_kind)}`
  if (filters.date_from) url += `&date_from=${encodeURIComponent(filters.date_from)}`
  if (filters.date_to) url += `&date_to=${encodeURIComponent(filters.date_to)}`
  return apiGet(url, token)
}

export async function searchRoom(username, room, q, token, limit = 50) {
  const u = encodeURIComponent(username)
  const r = encodeURIComponent(room)
  const query = encodeURIComponent(q)
  return apiGet(
    `/api/search_room?username=${u}&room=${r}&q=${query}&limit=${limit}`,
    token,
  )
}

export async function getDraft(username, roomId, token) {
  return apiGet(
    `/api/draft?username=${encodeURIComponent(username)}&room_id=${encodeURIComponent(roomId)}`,
    token,
  )
}

export async function saveDraft(username, roomId, text, token) {
  return apiPost('/api/draft', { username, room_id: roomId, text }, token)
}

export async function setChatMute(username, roomId, muted, token) {
  return apiPost('/api/chat_mute', { username, room_id: roomId, muted }, token)
}

export async function getMutedRooms(username, token) {
  return apiGet(`/api/chat_mute?username=${encodeURIComponent(username)}`, token)
}

export async function scheduleMessage(body, token) {
  return apiPost('/api/messages/schedule', body, token)
}

export async function getScheduledMessages(roomId, token) {
  return apiGet(
    `/api/messages/scheduled?room_id=${encodeURIComponent(roomId)}`,
    token,
  )
}

export async function updateScheduledMessage(schedId, body, token) {
  return apiPatch(`/api/messages/scheduled/${schedId}`, body, token)
}

export async function deleteScheduledMessage(schedId, token) {
  return apiDelete(`/api/messages/scheduled/${schedId}`, token)
}

export async function getReportsDashboard(token, params = {}) {
  const q = new URLSearchParams()
  if (params.sort) q.set('sort', params.sort)
  if (params.dir) q.set('dir', params.dir)
  if (params.status) q.set('status', params.status)
  const qs = q.toString()
  return apiGet(`/api/moderation/reports_dashboard${qs ? `?${qs}` : ''}`, token)
}

export async function moderationReportAction(body, token) {
  return apiPost('/api/moderation/report_action', body, token)
}

export async function moderationMessageContext(messageId, token) {
  return apiGet(`/api/moderation/message_context/${encodeURIComponent(messageId)}`, token)
}

export async function getModerationLogs(token, limit = 100) {
  return apiGet(`/api/moderation/logs?limit=${limit}`, token)
}

export async function reportMessage(
  { messageId, reportedBy, reportedUser, reason },
  token,
) {
  return apiPost(
    '/api/moderation/report',
    {
      message_id: messageId,
      reported_by: reportedBy,
      reported_user: reportedUser,
      reason: reason || 'Rules violation',
    },
    token,
  )
}

export async function uploadMedia(file, mediaType, token) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('media_type', mediaType || 'file')
  const res = await fetch(`${API_BASE}/api/upload_media`, {
    method: 'POST',
    headers: authHeaders(token, false),
    body: fd,
  })
  const data = await parseJsonResponse(res)
  if (res.status === 401) onSessionInvalid()
  return normalizeHttpResult(res, data)
}

export async function aiStatus(token) {
  return apiGet('/api/ai/status', token)
}

export async function aiRewrite(body, token) {
  return apiPost('/api/ai/rewrite', body, token)
}

export async function uploadAvatar(file, token) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`${API_BASE}/api/upload_avatar`, {
    method: 'POST',
    headers: authHeaders(token, false),
    body: fd,
  })
  const data = await parseJsonResponse(res)
  if (res.status === 401) onSessionInvalid()
  return normalizeHttpResult(res, data)
}

export function normalizeScheduledMessage(m) {
  const schedId = m.scheduled_id ?? m.id
  return {
    scheduled_id: schedId,
    message_id: m.message_id || `scheduled_${schedId}`,
    username: m.username,
    text: m.text || '',
    scheduled_at: m.scheduled_at || null,
    timestamp: m.scheduled_at || m.created_at || m.timestamp || null,
    is_scheduled: true,
    media: m.media || null,
    read_by: [],
    reactions: {},
    replyTo: m.replyTo || null,
    edited: false,
  }
}

export function normalizeMessage(m) {
  const id = m.message_id || m.id
  const ts =
    m.timestamp ||
    (m.created_at &&
      (typeof m.created_at === 'string' ? m.created_at : m.created_at.toISOString?.())) ||
    null
  let reactions = m.reactions
  if (reactions && !Array.isArray(reactions) && typeof reactions === 'object') {
    /* already emoji -> [users] */
  } else if (!reactions) {
    reactions = {}
  }
  return {
    message_id: id,
    username: m.username,
    text: m.text || '',
    timestamp: ts,
    expires_at: m.expires_at || null,
    media: m.media,
    read_by: Array.isArray(m.read_by) ? m.read_by : [],
    reactions: reactions && typeof reactions === 'object' ? reactions : {},
    replyTo: m.replyTo,
    forwarded: m.forwarded,
    edited: !!m.edited,
  }
}

export function privatePeer(roomId, me) {
  if (!roomId || !roomId.startsWith('private_')) return null
  const parts = roomId.slice(8).split('_')
  return parts.find((u) => u !== me) || null
}

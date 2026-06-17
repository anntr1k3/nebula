/** Счётчики непрочитанных и метки «прочитано» только в памяти вкладки (без localStorage). */

const readMap = Object.create(null)
const unreadMap = Object.create(null)

export function readUnreadMap() {
  return unreadMap
}

export function bumpUnread(roomId, activeRoomId, mutedRooms) {
  if (!roomId || roomId === activeRoomId) return
  if (mutedRooms && mutedRooms.has(roomId)) return
  unreadMap[roomId] = (unreadMap[roomId] || 0) + 1
  if (unreadMap[roomId] > 99) unreadMap[roomId] = 99
}

export function clearUnread(roomId) {
  delete unreadMap[roomId]
}

export function markRoomReadNow(roomId) {
  readMap[roomId] = new Date().toISOString()
  clearUnread(roomId)
}

/** Сброс карт комнат при выходе из аккаунта. */
export function clearRoomLocalCaches() {
  for (const k of Object.keys(readMap)) delete readMap[k]
  for (const k of Object.keys(unreadMap)) delete unreadMap[k]
}

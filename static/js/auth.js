import { clearRoomLocalCaches } from './read-maps.js'

export function getToken() {
  return localStorage.getItem('auth_token')
}

export function getUsername() {
  return localStorage.getItem('auth_username')
}

const VALID_ROLES = ['user', 'moderator', 'admin']

/** Пока false — не доверяем роли до ответа /api/me. */
let serverRoleConfirmed = false

/** Роль сессии только в памяти (не в localStorage). */
let sessionRole = 'user'

;(function migrateRoleFromLocalStorage() {
  try {
    const saved = localStorage.getItem('auth_role')
    if (saved != null && saved !== '') {
      sessionRole = normalizeRole(saved)
      localStorage.removeItem('auth_role')
    }
  } catch {
    /* ignore */
  }
})()

export function markServerRoleConfirmed() {
  serverRoleConfirmed = true
}

export function normalizeRole(role) {
  const r = String(role ?? 'user').toLowerCase().trim()
  return VALID_ROLES.includes(r) ? r : 'user'
}

export function getRole() {
  return normalizeRole(sessionRole)
}

export function isModerator() {
  if (!serverRoleConfirmed) return false
  return ['moderator', 'admin'].includes(getRole())
}

export function isAuthenticated() {
  return !!getToken()
}

export function setAuth({ token, username, role }) {
  localStorage.setItem('auth_token', token)
  localStorage.setItem('auth_username', username)
  sessionRole = normalizeRole(role)
}

export function clearAuth() {
  clearRoomLocalCaches()
  serverRoleConfirmed = false
  sessionRole = 'user'
  try {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_username')
    localStorage.removeItem('auth_role')
  } catch {
    /* ignore */
  }
}

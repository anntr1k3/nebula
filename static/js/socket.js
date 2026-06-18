import { getToken, getUsername } from './auth.js'

let socket = null

export function connectSocket() {
  if (typeof io === 'undefined') {
    console.warn('Клиент socket.io не загружен (проверьте скрипт на странице)')
    return null
  }
  if (socket?.connected) return socket
  /** Не создавать новый `io()` при обрыве: клиент сам переподключается; иначе теряются обработчики. */
  if (socket) return socket

  socket = io({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  })

  socket.on('connect', () => {
    const token = getToken()
    const username = getUsername()
    if (token && username) {
      socket.emit('user_online', { username, token })
    }
  })

  socket.on('connect_error', () => {
    console.warn('Ошибка подключения к серверу сокетов')
  })

  socket.on('error', (data) => {
    const msg = (data && data.message) || ''
    if (
      /sign in|log in again|authentication required|authentication error|token expired|user not found|please log in|session expired|banned/i.test(
        msg,
      )
    ) {
      window.dispatchEvent(new CustomEvent('nebula-auth-lost'))
      return
    }
    if (msg) {
      window.dispatchEvent(
        new CustomEvent('nebula-socket-app-error', { detail: { message: msg } }),
      )
    }
  })

  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

export function getSocket() {
  return socket
}

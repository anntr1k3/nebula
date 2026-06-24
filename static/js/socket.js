import { getToken, getUsername } from './auth.js'

let socket = null
/** Намеренное отключение (выход из аккаунта): не показывать баннер «обрыв связи». */
let intentionalDisconnect = false

export function connectSocket() {
  if (typeof io === 'undefined') {
    console.warn('Клиент socket.io не загружен (проверьте скрипт на странице)')
    return null
  }
  if (socket?.connected) return socket
  /** Не создавать новый `io()` при обрыве: клиент сам переподключается; иначе теряются обработчики. */
  if (socket) return socket

  intentionalDisconnect = false
  socket = io({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  })

  /** Чтобы не показывать «соединение восстановлено» при самом первом подключении. */
  let wasDisconnected = false

  const emitConnectionState = (state) => {
    window.dispatchEvent(
      new CustomEvent('nebula-connection-change', { detail: { state } }),
    )
  }

  socket.on('connect', () => {
    const token = getToken()
    const username = getUsername()
    if (token && username) {
      socket.emit('user_online', { username, token })
    }
    if (wasDisconnected) {
      wasDisconnected = false
      emitConnectionState('restored')
    }
  })

  socket.on('disconnect', (reason) => {
    // 'io client disconnect' = мы сами вызвали socket.disconnect() (выход) — это не обрыв.
    if (intentionalDisconnect || reason === 'io client disconnect') return
    wasDisconnected = true
    emitConnectionState('lost')
  })

  socket.on('connect_error', () => {
    if (intentionalDisconnect) return
    console.warn('Ошибка подключения к серверу сокетов')
    wasDisconnected = true
    emitConnectionState('lost')
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
  intentionalDisconnect = true
  if (socket) {
    socket.disconnect()
    socket = null
  }
  // Скрыть баннер связи, если он был показан (намеренный выход — не обрыв).
  window.dispatchEvent(
    new CustomEvent('nebula-connection-change', { detail: { state: 'reset' } }),
  )
}

export function getSocket() {
  return socket
}

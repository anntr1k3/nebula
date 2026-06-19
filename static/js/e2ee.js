import { getUsername } from './auth.js'
import { t } from './i18n.js'
import { els, state, showChatHeaderNotice, showToast } from './app-shell.js'
import { openSmoothModal, closeSmoothModal } from './modal-smooth.js'

const PREFIX = 'nebula:e2ee:v1:'
const STORAGE_PREFIX = 'nebula:e2ee:key'
const ALG = 'AES-GCM'
const KEY_LEN = 256

const keyCache = new Map()
let e2eeModalPreviousFocus = null

function cryptoApi() {
  return window.crypto?.subtle ? window.crypto : null
}

function roomStorageKey(roomId) {
  const user = getUsername() || 'anonymous'
  return `${STORAGE_PREFIX}:${user}:${roomId}`
}

function bytesToBase64(bytes) {
  let bin = ''
  bytes.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  return btoa(bin)
}

function base64ToBytes(value) {
  const bin = atob(String(value || ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

async function importRawKey(rawBytes) {
  const api = cryptoApi()
  if (!api) throw new Error('WebCrypto unavailable')
  return api.subtle.importKey('raw', rawBytes, { name: ALG }, false, [
    'encrypt',
    'decrypt',
  ])
}

async function getRoomKey(roomId) {
  if (!roomId) return null
  const cached = keyCache.get(roomId)
  if (cached) return cached
  const raw = localStorage.getItem(roomStorageKey(roomId))
  if (!raw) return null
  let key
  try {
    key = await importRawKey(base64ToBytes(raw))
  } catch {
    localStorage.removeItem(roomStorageKey(roomId))
    keyCache.delete(roomId)
    return null
  }
  keyCache.set(roomId, key)
  return key
}

async function saveRoomKey(roomId, rawBytes) {
  localStorage.setItem(roomStorageKey(roomId), bytesToBase64(rawBytes))
  keyCache.set(roomId, await importRawKey(rawBytes))
}

function notifyKeyChanged(roomId) {
  window.dispatchEvent(new CustomEvent('nebula-e2ee-key-changed', { detail: { roomId } }))
}

export function isE2eePayload(text) {
  return typeof text === 'string' && text.startsWith(PREFIX)
}

export function hasE2eeKey(roomId) {
  return !!roomId && !!localStorage.getItem(roomStorageKey(roomId))
}

export function exportE2eeKey(roomId) {
  return roomId ? localStorage.getItem(roomStorageKey(roomId)) || '' : ''
}

export async function generateE2eeKey(roomId) {
  const api = cryptoApi()
  if (!api || !roomId) return ''
  const raw = api.getRandomValues(new Uint8Array(32))
  await saveRoomKey(roomId, raw)
  syncE2eeButton()
  notifyKeyChanged(roomId)
  return bytesToBase64(raw)
}

export async function importE2eeKey(roomId, rawValue) {
  const clean = String(rawValue || '').trim()
  if (!roomId || !clean) return false
  let raw
  try {
    raw = base64ToBytes(clean)
  } catch {
    return false
  }
  if (raw.byteLength !== 32) return false
  await saveRoomKey(roomId, raw)
  syncE2eeButton()
  notifyKeyChanged(roomId)
  return true
}

export function removeE2eeKey(roomId) {
  if (!roomId) return
  localStorage.removeItem(roomStorageKey(roomId))
  keyCache.delete(roomId)
  syncE2eeButton()
  notifyKeyChanged(roomId)
}

export async function encryptTextForRoom(roomId, plainText) {
  const text = String(plainText || '')
  if (!text || isE2eePayload(text)) return text
  const key = await getRoomKey(roomId)
  const api = cryptoApi()
  if (!key || !api) return text
  const iv = api.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(text)
  const encrypted = await api.subtle.encrypt({ name: ALG, iv }, key, data)
  const payload = {
    alg: ALG,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(encrypted)),
  }
  return `${PREFIX}${JSON.stringify(payload)}`
}

export async function decryptTextForRoom(roomId, text) {
  const raw = String(text || '')
  if (!isE2eePayload(raw)) {
    return {
      text: raw,
      rawText: raw,
      encrypted: false,
      decrypted: false,
      missingKey: false,
    }
  }
  const key = await getRoomKey(roomId)
  const api = cryptoApi()
  if (!key || !api) {
    return {
      text: t('e2eeMissingKeyText'),
      rawText: raw,
      encrypted: true,
      decrypted: false,
      missingKey: true,
    }
  }
  try {
    const payload = JSON.parse(raw.slice(PREFIX.length))
    const iv = base64ToBytes(payload.iv)
    const ct = base64ToBytes(payload.ct)
    const plain = await api.subtle.decrypt({ name: ALG, iv }, key, ct)
    return {
      text: new TextDecoder().decode(plain),
      rawText: raw,
      encrypted: true,
      decrypted: true,
      missingKey: false,
    }
  } catch {
    return {
      text: t('e2eeDecryptFailedText'),
      rawText: raw,
      encrypted: true,
      decrypted: false,
      missingKey: false,
    }
  }
}

export async function decryptMessageForRoom(message, roomId) {
  if (!message || typeof message !== 'object') return message
  const next = { ...message }
  const dec = await decryptTextForRoom(roomId, next.text || '')
  next.text = dec.text
  next.rawText = dec.rawText
  next.e2ee = {
    encrypted: dec.encrypted,
    decrypted: dec.decrypted,
    missingKey: dec.missingKey,
  }
  if (next.replyTo?.text) {
    const replyDec = await decryptTextForRoom(roomId, next.replyTo.text)
    next.replyTo = {
      ...next.replyTo,
      text: replyDec.text,
      rawText: replyDec.rawText,
      e2ee: {
        encrypted: replyDec.encrypted,
        decrypted: replyDec.decrypted,
        missingKey: replyDec.missingKey,
      },
    }
  }
  return next
}

export async function decryptMessagesForRoom(messages, roomId) {
  return Promise.all((messages || []).map((m) => decryptMessageForRoom(m, roomId)))
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function syncE2eeButton() {
  const btn = els.btnChatE2ee
  if (!btn) return
  const active = !!state.currentRoom && hasE2eeKey(state.currentRoom)
  btn.hidden = !state.currentRoom
  btn.classList.toggle('is-active', active)
  btn.setAttribute('aria-pressed', active ? 'true' : 'false')
  btn.title = active ? t('e2eeEnabledTitle') : t('e2eeDisabledTitle')
  btn.setAttribute('aria-label', btn.title)
}

function syncE2eeModalState() {
  const hasKey = hasE2eeKey(state.currentRoom)
  if (els.btnE2eeCopy) els.btnE2eeCopy.disabled = !hasKey
  if (els.btnE2eeRemove) els.btnE2eeRemove.disabled = !hasKey
}

function showKeyInModal(key) {
  if (!els.e2eeGeneratedWrap || !els.e2eeGeneratedKey) return
  els.e2eeGeneratedWrap.hidden = !key
  els.e2eeGeneratedKey.value = key || ''
  if (key) {
    requestAnimationFrame(() => {
      els.e2eeGeneratedKey?.focus()
      els.e2eeGeneratedKey?.select()
    })
  }
}

function closeE2eeModal() {
  if (!els.modalE2eeKey) return
  closeSmoothModal(els.modalE2eeKey)
  const prev = e2eeModalPreviousFocus
  e2eeModalPreviousFocus = null
  prev?.focus?.()
}

function openE2eeModal() {
  if (!els.modalE2eeKey || !state.currentRoom) return
  e2eeModalPreviousFocus = document.activeElement
  if (els.e2eeKeyInput) els.e2eeKeyInput.value = ''
  showKeyInModal('')
  syncE2eeModalState()
  openSmoothModal(els.modalE2eeKey)
  requestAnimationFrame(() => els.e2eeKeyInput?.focus())
}

async function saveOrCreateE2eeKey() {
  const roomId = state.currentRoom
  if (!roomId) return
  const value = String(els.e2eeKeyInput?.value || '').trim()
  if (value) {
    const ok = await importE2eeKey(roomId, value)
    if (ok) {
      if (els.e2eeKeyInput) els.e2eeKeyInput.value = ''
      showKeyInModal('')
      syncE2eeModalState()
      showToast(t('e2eeImported'), 'success')
      showChatHeaderNotice(t('e2eeEnabledNotice'), 'success')
    } else {
      showToast(t('e2eeInvalidKey'), 'error')
      els.e2eeKeyInput?.focus()
    }
    return
  }
  const key = await generateE2eeKey(roomId)
  if (!key) {
    showToast(t('e2eeCryptoUnavailable'), 'error')
    return
  }
  const copied = await copyToClipboard(key)
  showKeyInModal(key)
  syncE2eeModalState()
  showToast(copied ? t('e2eeGeneratedCopied') : t('e2eeGenerated'), 'success')
  showChatHeaderNotice(t('e2eeEnabledNotice'), 'success')
}

async function copyCurrentE2eeKey() {
  const roomId = state.currentRoom
  const key = exportE2eeKey(roomId)
  if (!key) {
    showToast(t('e2eeNoKeyToCopy'), 'error')
    syncE2eeModalState()
    return
  }
  showKeyInModal(key)
  const copied = await copyToClipboard(key)
  showToast(copied ? t('e2eeKeyCopied') : t('copyFailed'), copied ? 'success' : 'error')
}

function removeCurrentE2eeKey() {
  const roomId = state.currentRoom
  if (!roomId || !hasE2eeKey(roomId)) return
  if (!window.confirm(t('e2eeRemoveConfirm'))) return
  removeE2eeKey(roomId)
  if (els.e2eeKeyInput) els.e2eeKeyInput.value = ''
  showKeyInModal('')
  syncE2eeModalState()
  showToast(t('e2eeRemoved'), 'success')
}

export function bindE2eeUi() {
  const btn = els.btnChatE2ee
  if (!btn || btn.dataset.e2eeBound === '1') return
  btn.dataset.e2eeBound = '1'
  btn.addEventListener('click', () => {
    if (!state.currentRoom) return
    openE2eeModal()
  })
  els.btnE2eeSave?.addEventListener('click', () => void saveOrCreateE2eeKey())
  els.btnE2eeCopy?.addEventListener('click', () => void copyCurrentE2eeKey())
  els.btnE2eeRemove?.addEventListener('click', removeCurrentE2eeKey)
  els.btnE2eeClose?.addEventListener('click', closeE2eeModal)
  els.modalE2eeKey?.addEventListener('click', (e) => {
    if (e.target === els.modalE2eeKey) closeE2eeModal()
  })
  els.e2eeKeyInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeE2eeModal()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void saveOrCreateE2eeKey()
    }
  })
  syncE2eeButton()
}

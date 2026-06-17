/**
 * Рантайм i18n: переключение локали, резолв ключей, транслятор сообщений API,
 * патч DOM по атрибутам `data-i18n*`. Сами словари (RU/EN) вынесены в
 * `./i18n/ru.js` и `./i18n/en.js` — отдельные ES-модули, загружаются синхронно
 * вместе с этим файлом.
 */

import ru from './i18n/ru.js'
import en from './i18n/en.js'

const VALID_LOCALES = ['en', 'ru']
const messages = { ru, en }

function readStoredLocale() {
  const raw = localStorage.getItem('language')
  if (raw == null || raw === '') return 'ru'
  return VALID_LOCALES.includes(raw) ? raw : 'ru'
}

let locale = readStoredLocale()

function syncDocumentLang() {
  document.documentElement.lang = locale === 'ru' ? 'ru' : 'en'
}

syncDocumentLang()

export function getLocale() {
  return locale
}

export function setLocale(l) {
  if (!VALID_LOCALES.includes(l)) return
  locale = l
  localStorage.setItem('language', l)
  syncDocumentLang()
  window.dispatchEvent(new CustomEvent('nebula-locale'))
}

export function t(key) {
  const pack = messages[locale] || messages.ru
  return pack[key] ?? messages.ru[key] ?? messages.en[key] ?? key
}

/** English strings from Flask/Socket.IO; mapped to i18n keys for the active locale. */
const API_MESSAGE_KEYS = {
  'Invalid credentials': 'invalidCredentials',
  'Fill in all fields': 'fillAllFields',
  'Username must be 2-32 characters (letters, digits, underscore)': 'usernameRules',
  'Password cannot be empty': 'passwordEmpty',
  'Password must be at least 8 characters': 'passwordMinLength',
  'Password is too long (max 128 characters)': 'passwordTooLong',
  'Password must contain at least one letter': 'passwordNeedLetter',
  'Password must contain at least one digit': 'passwordNeedDigit',
  'User already exists': 'userAlreadyExists',
  'Registration failed': 'registrationFailed',
  'Registration successful': 'registrationApiSuccess',
  'Image too large (max 2 MB)': 'imageTooLarge2mb',
  'Allowed types: JPEG, PNG, WebP, GIF': 'avatarTypesHint',
  'Invalid avatar image path': 'avatarInvalidPath',
  'Save failed': 'profileSaveFailed',
  'No access to this chat': 'noChatAccess',
  'Message too long': 'socketMessageTooLong',
  'Too many messages. Please wait a moment.': 'socketRateLimit',
  'Media file too large': 'socketMediaTooLarge',
  'Media type not allowed': 'socketMediaTypeBlocked',
  'Could not save message': 'socketCouldNotSave',
  'Failed to send message': 'socketSendFailed',
  'Invalid text length': 'socketInvalidEditLength',
  'Missing required fields': 'socketMissingFields',
  'Server error': 'socketServerError',
  'Access denied': 'accessDenied',
  'User not specified': 'userNotSpecified',
  'Cannot ban an administrator': 'cannotBanAdmin',
  'Cannot ban another moderator': 'cannotBanModerator',
  'Ban failed': 'banFailed',
  'Unban failed': 'unbanFailed',
  'Could not issue warning': 'couldNotIssueWarning',
  'Message not specified': 'messageNotSpecified',
  'Could not delete message': 'couldNotDeleteMessage',
  'Could not create report': 'couldNotCreateReport',
  'Report not specified': 'reportNotSpecified',
  'Could not resolve report': 'couldNotResolveReport',
  'Message not found': 'messageNotFound',
  'Missing fields': 'missingFieldsShort',
  'Report not found': 'reportNotFound',
  'Cannot act on administrator': 'cannotActOnAdmin',
  'Cannot act on another moderator': 'cannotActOnModerator',
  'Could not dismiss': 'couldNotDismiss',
  'Could not warn': 'couldNotWarnModeration',
  'Unknown action': 'unknownModerationAction',
  'No file selected': 'noFileSelected',
  'File too large (max 20 MB)': 'fileTooLarge20mb',
  'Administrators only': 'administratorsOnly',
  'Cache cleared': 'cacheCleared',
  'Block failed': 'blockFailed',
  'Unblock failed': 'unblockFailed',
  'Could not create group': 'couldNotCreateGroup',
  'Pin failed': 'pinFailed',
  'Unpin failed': 'unpinFailed',
  'Invalid request': 'invalidRequest',
  'Failed': 'genericFailed',
  'room_id required': 'roomIdRequired',
  'User not found': 'userNotFound',
  'Invalid message': 'invalidMessage',
  'Cannot post here': 'cannotPostHere',
  'Bad datetime': 'badDatetime',
  'Time must be in the future': 'timeMustBeFuture',
  'Could not schedule': 'couldNotSchedule',
  'Not found': 'scheduledNotFound',
  'Could not update': 'couldNotUpdateScheduled',
  'Could not delete': 'couldNotDeleteScheduled',
  'room and username are required': 'roomAndUsernameRequired',
  'username is required': 'usernameRequired',
  'Enter a query or choose filters': 'enterQueryOrFilters',
  'Query must be at least 2 characters': 'queryMin2Chars',
  'Query required': 'queryRequired',
  'username and room required': 'usernameRoomRequired',
  'AI assistant is not configured on the server': 'aiNotConfigured',
  'AI service error': 'aiFailed',
  'AI service unavailable': 'aiFailed',
  'AI service timeout': 'aiFailed',
  'Empty AI response': 'aiFailed',
  'Unknown AI action': 'aiFailed',
  'Server is not configured': 'serverNotConfigured',
  'Authentication required': 'authenticationRequired',
  'Session expired, please log in again': 'sessionExpiredLogin',
  'Account not found. Please sign in again.': 'accountNotFoundSignIn',
  'Authentication required. Call user_online after login.': 'socketAuthCallUserOnline',
  'Authentication error': 'authenticationError',
  'Authentication required. Please log in again.': 'authenticationRequiredLoginAgain',
  'Token expired, please log in again': 'tokenExpiredLogin',
  'Your account is banned. You cannot send messages.': 'accountBannedNoSend',
  'Message not found in this room': 'messageNotFoundInRoom',
  'Failed to add reaction': 'failedAddReaction',
  "You cannot edit someone else's messages": 'cannotEditOthersMessages',
  'Room does not match message': 'roomDoesNotMatchMessage',
  'Failed to edit message': 'failedEditMessage',
  "You cannot delete someone else's messages": 'cannotDeleteOthersMessages',
  'Failed to delete message': 'failedDeleteMessage',
  'Message does not belong to this room': 'messageWrongRoom',
  'Failed to pin message': 'failedPinMessage',
  'Failed to unpin message': 'failedUnpinMessage',
  'Invalid data format': 'invalidDataFormat',
  'Could not validate file type': 'couldNotValidateFileType',
}

export function translateApiMessage(msg) {
  if (msg == null || typeof msg !== 'string') return msg
  const key = API_MESSAGE_KEYS[msg]
  if (key) return t(key)
  const fileType = msg.match(/^File type not allowed: (.+)$/)
  if (fileType) return t('fileTypeNotAllowed').replace('{type}', fileType[1])
  let m = msg.match(/^Your account is banned until (.+)\. Reason: (.+)$/)
  if (m) {
    return t('accountBannedUntil')
      .replace('{until}', m[1])
      .replace('{reason}', m[2])
  }
  m = msg.match(/^Your account is permanently banned\. Reason: (.+)$/)
  if (m) return t('accountBannedPermanent').replace('{reason}', m[1])
  return msg
}

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function applyI18nToDom(root = document, options = {}) {
  const { animate = true } = options

  const patch = () => {
    syncDocumentLang()
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const k = el.getAttribute('data-i18n')
      if (k) el.textContent = t(k)
    })
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const k = el.getAttribute('data-i18n-placeholder')
      if (!k) return
      const v = t(k)
      if (el.getAttribute('contenteditable') === 'true' || el.isContentEditable) {
        el.setAttribute('data-placeholder', v)
      } else {
        el.placeholder = v
      }
    })
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const k = el.getAttribute('data-i18n-title')
      if (k) el.title = t(k)
    })
    root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const k = el.getAttribute('data-i18n-aria')
      if (k) el.setAttribute('aria-label', t(k))
    })
    document.title = t('appTitle')
  }

  if (!animate || prefersReducedMotion()) {
    patch()
    return Promise.resolve()
  }

  const shell = document.getElementById('app-root')
  if (!shell) {
    patch()
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const html = document.documentElement
    let step = 'out'
    let done = false

    const cleanup = () => {
      shell.removeEventListener('transitionend', onEnd)
      html.classList.remove('i18n-switching')
    }

    const finish = () => {
      if (done) return
      done = true
      cleanup()
      resolve()
    }

    const onEnd = (e) => {
      if (e.target !== shell || e.propertyName !== 'opacity') return
      if (step === 'out') {
        step = 'in'
        patch()
        html.classList.remove('i18n-switching')
      } else {
        finish()
      }
    }

    shell.addEventListener('transitionend', onEnd)
    html.classList.add('i18n-switching')

    window.setTimeout(() => {
      if (done) return
      if (step === 'out') patch()
      finish()
    }, 600)
  })
}

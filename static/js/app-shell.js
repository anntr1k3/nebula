import { readStoredTheme } from './themes.js'
import { $ } from './dom.js'

export const els = {}

export const state = {
  privateChatsMeta: [],
  rooms: [],
  currentRoom: null,
  currentChatType: null,
  messages: [],
  theme: readStoredTheme(),
  authMode: 'login',
  messengerBootstrapped: false,
  replyTo: null,
  pendingMedia: null,
  scheduledMessages: [],
  messagesHasMore: false,
  loadingOlderMessages: false,
  onlineByUser: {},
  /** username -> { avatar, avatarType, nickname } из /api/users и socket user_profile_updated */
  userProfileCache: {},
  inboxDebounce: null,
  typingHideTimer: null,
  lastTypingEmit: 0,
  contextMessage: null,
  longPressTimer: null,
  usersPollTimer: null,
  blockedSet: new Set(),
  mutedRooms: new Set(),
  draftSaveTimer: null,
}

export function collectEls() {
  els.viewAuth = $('#view-auth')
  els.viewMessenger = $('#view-messenger')
  els.viewAdmin = $('#view-admin')
  els.authLogin = $('#auth-login')
  els.authRegister = $('#auth-register')
  els.toast = $('#toast')
  els.modalCreate = $('#modal-create-room')
  els.modalProfileEdit = $('#modal-profile-edit')
  els.modalAppSettings = $('#modal-app-settings')
  els.modalDeleteMessage = $('#modal-delete-message')
  els.btnDeleteMessageConfirm = $('#btn-delete-message-confirm')
  els.btnDeleteMessageCancel = $('#btn-delete-message-cancel')
  els.modalReportMessage = $('#modal-report-message')
  els.reportMessageInput = $('#report-message-input')
  els.btnReportMessageConfirm = $('#btn-report-message-confirm')
  els.btnReportMessageCancel = $('#btn-report-message-cancel')
  els.modalPinnedList = $('#modal-pinned-list')
  els.pinnedModalList = $('#pinned-modal-list')
  els.btnPinnedListClose = $('#btn-pinned-list-close')
  els.modalEditMessage = $('#modal-edit-message')
  els.editMessageInput = $('#edit-message-input')
  els.btnEditMessageConfirm = $('#btn-edit-message-confirm')
  els.btnEditMessageCancel = $('#btn-edit-message-cancel')
  els.modalScheduledList = $('#modal-scheduled-list')
  els.scheduledList = $('#scheduled-list')
  els.scheduledListEmpty = $('#scheduled-list-empty')
  els.btnScheduledListClose = $('#btn-scheduled-list-close')
  els.btnChatScheduled = $('#btn-chat-scheduled')
  els.chatScheduledCount = $('#chat-scheduled-count')
  els.btnChatE2ee = $('#btn-chat-e2ee')
  els.modalE2eeKey = $('#modal-e2ee-key')
  els.e2eeKeyInput = $('#e2ee-key-input')
  els.e2eeGeneratedWrap = $('#e2ee-generated-wrap')
  els.e2eeGeneratedKey = $('#e2ee-generated-key')
  els.btnE2eeSave = $('#btn-e2ee-save')
  els.btnE2eeCopy = $('#btn-e2ee-copy')
  els.btnE2eeRemove = $('#btn-e2ee-remove')
  els.btnE2eeClose = $('#btn-e2ee-close')
  els.modalEditScheduled = $('#modal-edit-scheduled')
  els.editScheduledInput = $('#edit-scheduled-input')
  els.editScheduledDatetime = $('#edit-scheduled-datetime')
  els.btnEditScheduledConfirm = $('#btn-edit-scheduled-confirm')
  els.btnEditScheduledCancel = $('#btn-edit-scheduled-cancel')
  els.modalDeleteScheduled = $('#modal-delete-scheduled')
  els.btnDeleteScheduledConfirm = $('#btn-delete-scheduled-confirm')
  els.btnDeleteScheduledCancel = $('#btn-delete-scheduled-cancel')
  els.btnAppSettings = $('#btn-app-settings')
  els.membersList = $('#members-list')
  els.membersSearch = $('#members-search')
  els.newChatUser = $('#new-chat-user')
  els.newChatSuggestions = $('#new-chat-suggestions')
  els.inboxList = $('#inbox-list')
  els.inboxEmpty = $('#inbox-empty')
  els.messagesContainer = $('#messages-container')
  els.messagesLoadOlder = $('#messages-load-older')
  els.chatEmptyState = $('#chat-empty-state')
  els.composerOuter = $('#composer-outer') || document.querySelector('.composer-outer')
  els.composerToolbar = $('#composer-toolbar')
  els.chatTitle = $('#chat-title')
  els.chatHeaderNotice = $('#chat-header-notice')
  els.noChat = $('#no-chat')
  els.chatPanel = $('#chat-panel')
  els.messengerUsername = $('#messenger-username')
  els.adminUsername = $('#admin-username')
  els.btnAdmin = $('#btn-admin')
  els.messageInput = $('#message-input')
  els.btnSend = $('#btn-send')
  els.btnAttach = $('#btn-attach')
  els.fileInput = $('#file-attach-input')
  els.replyPreview = $('#reply-preview')
  els.replyPreviewText = $('#reply-preview-text')
  els.composerMediaPreview = $('#composer-media-preview')
  els.composerMediaPreviewThumb = $('#composer-media-preview-thumb')
  els.composerMediaPreviewIcon = $('#composer-media-preview-icon')
  els.composerMediaPreviewLabel = $('#composer-media-preview-label')
  els.btnClearPendingMedia = $('#btn-clear-pending-media')
  els.pinnedStrip = $('#pinned-strip')
  els.typingBar = $('#typing-bar')
  els.ctxMenu = $('#ctx-menu')
  els.emojiBar = $('#emoji-bar')
  els.emojiPickerExpanded = $('#emoji-picker-expanded')
  els.emojiPickerBackdrop = $('#emoji-picker-backdrop')
  els.globalSearch = $('#global-search-input')
  els.searchResults = $('#search-results')
  els.profileNickname = $('#profile-nickname')
  els.profileBio = $('#profile-bio')
  els.profileAvatar = $('#profile-avatar')
  els.sidebarUserAvatar = $('#sidebar-user-avatar')
  els.profileAvatarPreview = $('#profile-avatar-preview')
  els.profileAvatarFile = $('#profile-avatar-file')
  els.btnProfileAvatarUpload = $('#btn-profile-avatar-upload')
  els.btnProfileAvatarClear = $('#btn-profile-avatar-clear')
  els.profileEmojiWrap = $('#profile-emoji-wrap')
  els.blockedList = $('#blocked-list')
  els.blockUsernameInput = $('#block-username-input')
  els.chatHeaderActions = $('#chat-header-actions')
  els.btnChatBack = $('#btn-chat-back')
  els.ttlSelect = $('#ttl-select')
  els.composerTtlWrap = $('#composer-ttl-wrap')
  els.ttlSelectTrigger = $('#ttl-select-trigger')
  els.ttlPopover = $('#ttl-popover')
  els.schedulePopover = $('#schedule-popover')
  els.scheduleDatetimeInput = $('#schedule-datetime-input')
  els.scheduleCancel = $('#schedule-cancel')
  els.scheduleConfirm = $('#schedule-confirm')
  els.btnVoiceRecord = $('#btn-voice-record')
  els.btnScheduleSend = $('#btn-schedule-send')
  els.btnAiAssist = $('#btn-ai-assist')
  els.aiPopover = $('#ai-assist-popover')
  els.editAiSection = $('#edit-ai-section')
  els.editAiToolbar = $('#edit-ai-toolbar')
  els.btnChatDnd = $('#btn-chat-dnd')
  els.btnChatLocalSearch = $('#btn-chat-local-search')
  els.localSearchPanel = $('#local-search-panel')
  els.localSearchInput = $('#local-search-input')
  els.localSearchResults = $('#local-search-results')
  els.adminReportsList = $('#admin-reports-list')
  els.adminLogsList = $('#admin-logs-list')
  els.adminReportSort = $('#admin-report-sort')
  els.adminReportsRefresh = $('#admin-reports-refresh')
  els.mediaViewer = $('#media-viewer')
}

const TOAST_DISPLAY_MS = 3000
/** Синхронно с `static/css/main.css` → `:root { --duration-modal }` (0.32s = 320ms). */
const TOAST_TRANSITION_MS = 320

let toastRaf1 = 0
let toastRaf2 = 0
let toastHideListener = null
let toastHideFallback = null

function cancelToastHide() {
  if (toastHideListener) {
    els.toast.removeEventListener('transitionend', toastHideListener)
    toastHideListener = null
  }
  clearTimeout(toastHideFallback)
  toastHideFallback = null
}

function cancelToastEnter() {
  if (toastRaf1) cancelAnimationFrame(toastRaf1)
  if (toastRaf2) cancelAnimationFrame(toastRaf2)
  toastRaf1 = 0
  toastRaf2 = 0
}

function scheduleToastEnter() {
  cancelToastEnter()
  toastRaf1 = requestAnimationFrame(() => {
    toastRaf1 = 0
    toastRaf2 = requestAnimationFrame(() => {
      toastRaf2 = 0
      els.toast.classList.add('toast--visible')
    })
  })
}

function hideToastAnimated() {
  if (els.toast.hidden) return
  if (!els.toast.classList.contains('toast--visible')) {
    els.toast.hidden = true
    return
  }
  cancelToastHide()
  let done = false
  const finish = () => {
    if (done) return
    done = true
    cancelToastHide()
    els.toast.hidden = true
  }
  const onEnd = (e) => {
    if (e.target !== els.toast || e.propertyName !== 'opacity') return
    finish()
  }
  toastHideListener = onEnd
  els.toast.addEventListener('transitionend', onEnd)
  els.toast.classList.remove('toast--visible')
  toastHideFallback = setTimeout(finish, TOAST_TRANSITION_MS + 120)
}

const CHAT_HEADER_NOTICE_MS = 3200
/** Синхронно с `--duration-modal` + запас на transitionend. */
const CHAT_HEADER_NOTICE_HIDE_MS = 360
let chatHeaderNoticeTimer = null
let chatHeaderNoticeHideTimer = null
let chatHeaderNoticeHideListener = null

function finishChatHeaderNoticeHide() {
  if (!els.chatHeaderNotice) return
  if (chatHeaderNoticeHideListener) {
    els.chatHeaderNotice.removeEventListener('transitionend', chatHeaderNoticeHideListener)
    chatHeaderNoticeHideListener = null
  }
  clearTimeout(chatHeaderNoticeHideTimer)
  chatHeaderNoticeHideTimer = null
  els.chatHeaderNotice.hidden = true
  els.chatHeaderNotice.textContent = ''
  els.chatHeaderNotice.classList.remove(
    'error',
    'success',
    'info',
    'chat-header-notice--visible',
  )
}

export function hideChatHeaderNotice() {
  if (!els.chatHeaderNotice) return
  clearTimeout(chatHeaderNoticeTimer)
  chatHeaderNoticeTimer = null
  if (els.chatHeaderNotice.hidden) return
  if (!els.chatHeaderNotice.classList.contains('chat-header-notice--visible')) {
    finishChatHeaderNoticeHide()
    return
  }
  if (chatHeaderNoticeHideListener) {
    els.chatHeaderNotice.removeEventListener('transitionend', chatHeaderNoticeHideListener)
  }
  chatHeaderNoticeHideListener = (e) => {
    if (e.target !== els.chatHeaderNotice) return
    if (e.propertyName !== 'opacity' && e.propertyName !== 'transform') return
    finishChatHeaderNoticeHide()
  }
  els.chatHeaderNotice.addEventListener('transitionend', chatHeaderNoticeHideListener)
  els.chatHeaderNotice.classList.remove('chat-header-notice--visible')
  chatHeaderNoticeHideTimer = setTimeout(finishChatHeaderNoticeHide, CHAT_HEADER_NOTICE_HIDE_MS)
}

export function showChatHeaderNotice(message, type = 'info') {
  if (!els.chatHeaderNotice || !message) return
  clearTimeout(chatHeaderNoticeTimer)
  clearTimeout(chatHeaderNoticeHideTimer)
  if (chatHeaderNoticeHideListener) {
    els.chatHeaderNotice.removeEventListener('transitionend', chatHeaderNoticeHideListener)
    chatHeaderNoticeHideListener = null
  }
  els.chatHeaderNotice.textContent = message
  els.chatHeaderNotice.classList.remove('error', 'success', 'info', 'chat-header-notice--visible')
  els.chatHeaderNotice.classList.add(type)
  els.chatHeaderNotice.hidden = false
  void els.chatHeaderNotice.offsetWidth
  els.chatHeaderNotice.classList.add('chat-header-notice--visible')
  chatHeaderNoticeTimer = setTimeout(() => hideChatHeaderNotice(), CHAT_HEADER_NOTICE_MS)
}

export function showToast(message, type = 'info') {
  cancelToastHide()
  clearTimeout(showToast._t)
  cancelToastEnter()

  const normalizedType = ['error', 'success', 'warning', 'info'].includes(type) ? type : 'info'
  const iconMap = {
    error: '!',
    success: '✓',
    warning: '!',
    info: 'i',
  }
  els.toast.replaceChildren()
  const icon = document.createElement('span')
  icon.className = 'toast-icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.textContent = iconMap[normalizedType]
  const text = document.createElement('span')
  text.className = 'toast-message'
  text.textContent = message
  els.toast.appendChild(icon)
  els.toast.appendChild(text)
  els.toast.classList.remove('error', 'success', 'warning', 'info', 'toast--visible')
  els.toast.classList.add(normalizedType)
  els.toast.hidden = false
  scheduleToastEnter()

  showToast._t = setTimeout(() => hideToastAnimated(), TOAST_DISPLAY_MS)
}

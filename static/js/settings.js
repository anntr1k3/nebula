import * as api from './api.js'
import { getToken, getUsername } from './auth.js'
import { t, translateApiMessage } from './i18n.js'
import { els, showToast } from './app-shell.js'
import { onPasteInsertPlainText } from './dom.js'
import { refreshBlockedSet, refreshInbox } from './inbox.js'
import {
  getComposerCaretPlainOffset,
  normalizeComposerEmojiInPlace,
  plainTextFromComposerRoot,
  setComposerCaretPlainOffset,
  setComposerPlainText,
  syncComposerEmptyAttr,
  truncatePlainToMaxCodeUnits,
} from './emoji-apple.js'
import { fillUserAvatarElement } from './user-avatar.js'

/** 'emoji' | 'image' */
let profileAvatarMode = 'emoji'
/** Stored path /media/... when image mode */
let pendingAvatarPath = ''

function updateProfileAvatarPreview() {
  const raw =
    profileAvatarMode === 'image'
      ? pendingAvatarPath
      : els.profileAvatar
        ? plainTextFromComposerRoot(els.profileAvatar).trim()
        : ''
  fillUserAvatarElement(
    els.profileAvatarPreview,
    raw,
    profileAvatarMode === 'image' ? 'image' : 'emoji',
  )
}

function syncEmojiRowVisibility() {
  const wrap = els.profileEmojiWrap
  const clearBtn = els.btnProfileAvatarClear
  if (wrap) wrap.hidden = profileAvatarMode === 'image'
  if (clearBtn) clearBtn.hidden = profileAvatarMode !== 'image'
}

function updateSidebarAvatarEl(avatar, avatarType) {
  fillUserAvatarElement(els.sidebarUserAvatar, avatar, avatarType)
}

export async function loadSettingsProfile() {
  const uname = getUsername()
  const token = getToken()
  const p = await api.getProfile(uname, token)
  els.profileNickname.value = p.nickname || uname
  els.profileBio.value = p.bio || ''
  const avType = (p.avatarType || 'emoji').toLowerCase()
  if (avType === 'image' && p.avatar && String(p.avatar).startsWith('/media/')) {
    profileAvatarMode = 'image'
    pendingAvatarPath = p.avatar
  } else {
    profileAvatarMode = 'emoji'
    pendingAvatarPath = ''
    const a = p.avatar
    const avText =
      a &&
      a !== '👤' &&
      String(a).toLowerCase() !== 'user' &&
      !String(a).startsWith('/media/')
        ? a
        : ''
    if (els.profileAvatar) setComposerPlainText(els.profileAvatar, avText)
  }
  if (els.profileAvatarFile) els.profileAvatarFile.value = ''
  updateProfileAvatarPreview()
  syncEmojiRowVisibility()
}

/** Sidebar title: nickname if set, else login username; also refresh avatar. */
export async function refreshSidebarProfileLabel() {
  const uname = getUsername()
  const token = getToken()
  if (!uname || !els.messengerUsername) return
  try {
    const p = await api.getProfile(uname, token)
    const label = (p.nickname && String(p.nickname).trim()) || uname
    els.messengerUsername.textContent = label
    updateSidebarAvatarEl(p.avatar, p.avatarType)
  } catch {
    els.messengerUsername.textContent = uname
    updateSidebarAvatarEl(null, 'emoji')
  }
}

async function onProfileAvatarFileSelected() {
  const f = els.profileAvatarFile?.files?.[0]
  if (!f) return
  const r = await api.uploadAvatar(f, getToken())
  if (r.success && r.path) {
    profileAvatarMode = 'image'
    pendingAvatarPath = r.path
    updateProfileAvatarPreview()
    syncEmojiRowVisibility()
  } else {
    showToast(translateApiMessage(r.message) || t('avatarUploadError'), 'error')
  }
  els.profileAvatarFile.value = ''
}

export async function saveSettingsProfile() {
  const avatarType =
    profileAvatarMode === 'image' && pendingAvatarPath ? 'image' : 'emoji'
  const avatar =
    avatarType === 'image'
      ? pendingAvatarPath
      : els.profileAvatar
        ? plainTextFromComposerRoot(els.profileAvatar).trim()
        : ''
  const r = await api.updateProfile(
    {
      username: getUsername(),
      nickname: els.profileNickname.value.trim(),
      bio: els.profileBio.value.trim(),
      avatar,
      avatarType,
    },
    getToken(),
  )
  if (r.success) {
    showToast(t('actionOk'), 'success')
    await refreshSidebarProfileLabel()
    return true
  }
  showToast(translateApiMessage(r.message) || t('genericError'), 'error')
  return false
}

export async function refreshBlockedList() {
  const uname = getUsername()
  const token = getToken()
  if (!uname || !token) {
    els.blockedList.innerHTML = ''
    return
  }
  const data = await api.getBlocked(uname, token)
  const blocked = data.blocked || []
  els.blockedList.innerHTML = ''
  blocked.forEach((u) => {
    const row = document.createElement('div')
    row.className = 'blocked-row'
    const name = document.createElement('span')
    name.textContent = u
    row.appendChild(name)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'glass-button-secondary'
    btn.textContent = t('unblockButton')
    btn.addEventListener('click', async () => {
      await api.unblockUser(getUsername(), u, getToken())
      await refreshBlockedSet()
      refreshBlockedList()
      refreshInbox()
    })
    row.appendChild(btn)
    els.blockedList.appendChild(row)
  })
}

export function bindProfileAvatarUi() {
  if (!els.btnProfileAvatarUpload || !els.profileAvatarFile) return
  els.btnProfileAvatarUpload.addEventListener('click', () => {
    els.profileAvatarFile.click()
  })
  els.profileAvatarFile.addEventListener('change', () => void onProfileAvatarFileSelected())
  if (els.btnProfileAvatarClear) {
    els.btnProfileAvatarClear.addEventListener('click', () => {
      profileAvatarMode = 'emoji'
      pendingAvatarPath = ''
      els.profileAvatarFile.value = ''
      updateProfileAvatarPreview()
      syncEmojiRowVisibility()
    })
  }
  if (els.profileAvatar) {
    els.profileAvatar.addEventListener('paste', (e) => {
      if (profileAvatarMode !== 'emoji') return
      onPasteInsertPlainText(e, () => {
        els.profileAvatar.dispatchEvent(new Event('input', { bubbles: true }))
      })
    })
    els.profileAvatar.addEventListener('input', () => {
      if (profileAvatarMode !== 'emoji') return
      let pos = 0
      try {
        pos = getComposerCaretPlainOffset(els.profileAvatar)
      } catch {
        pos = plainTextFromComposerRoot(els.profileAvatar).length
      }
      normalizeComposerEmojiInPlace(els.profileAvatar)
      let s = plainTextFromComposerRoot(els.profileAvatar)
      const t = truncatePlainToMaxCodeUnits(s, 32)
      if (t !== s) {
        setComposerPlainText(els.profileAvatar, t)
        try {
          setComposerCaretPlainOffset(els.profileAvatar, Math.min(pos, t.length))
        } catch {
          /* ignore */
        }
      }
      syncComposerEmptyAttr(els.profileAvatar)
      updateProfileAvatarPreview()
    })
  }
}

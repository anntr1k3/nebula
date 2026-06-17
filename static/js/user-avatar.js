import { fillElementWithAppleEmoji } from './emoji-apple.js'

export function fillUserAvatarElement(el, avatar, avatarType) {
  if (!el) return
  el.innerHTML = ''
  const at = (avatarType || 'emoji').toLowerCase()
  if (at === 'image' && avatar && String(avatar).startsWith('/media/')) {
    const img = document.createElement('img')
    img.src = avatar
    img.alt = ''
    img.className = 'user-avatar-img'
    img.loading = 'lazy'
    el.appendChild(img)
    return
  }

  const raw = String(avatar || '').trim()
  const isPlaceholder =
    !raw ||
    raw === '👤' ||
    raw.toLowerCase() === 'user' ||
    raw.startsWith('/media/')

  if (!isPlaceholder) {
    fillElementWithAppleEmoji(el, raw)
  } else {
    el.innerHTML = '<i class="fa-solid fa-user" aria-hidden="true"></i>'
  }
}

const loaded = new Set()

/**
 * Подгружает stylesheet один раз (для экранов вне основного main.css).
 * @param {string} href
 * @param {string} id
 */
export function ensureStylesheet(href, id) {
  if (loaded.has(href) || document.getElementById(id)) {
    loaded.add(href)
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.id = id
    link.onload = () => {
      loaded.add(href)
      resolve()
    }
    link.onerror = () => reject(new Error(`Failed to load ${href}`))
    document.head.appendChild(link)
  })
}

const ADMIN_CSS = '/css/admin.css?v=nebula-3'

export function ensureAdminStyles() {
  return ensureStylesheet(ADMIN_CSS, 'nebula-admin-css')
}

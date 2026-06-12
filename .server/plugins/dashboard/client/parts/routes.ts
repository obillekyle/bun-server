declare const is: any
declare const match: any

export let registeredRoutes: Record<string, any> = {}
export let activeSelectedRouteObj: any = null
export let sandboxCurrentView: 'code' | 'preview' = 'code'
export let sandboxLastHtml = ''

type ExplorerNode =
  | {
      name: string
      type: 'folder'
      children: Map<string, ExplorerNode>
      route: ''
    }
  | {
      name: string
      type: 'file'
      children: Map<string, ExplorerNode>
      route: any
    }

function collapseExplorerTree(node: ExplorerNode) {
  if (node.type !== 'folder') return
  for (const childNode of node.children.values()) {
    collapseExplorerTree(childNode)
  }

  const childEntries = Array.from(node.children.entries())
  if (childEntries.length === 1 && node.name !== 'root') {
    const [_childName, childNode] = childEntries[0]
    if (childNode.type === 'folder') {
      node.name = `${node.name}/${childNode.name}`
      node.children = childNode.children
      collapseExplorerTree(node)
    }
  }
}

function buildExplorerTree(routes: Record<string, any>) {
  const root: ExplorerNode = {
    name: 'root',
    type: 'folder',
    children: new Map(),
    route: '',
  }

  for (const [path, info] of Object.entries(routes)) {
    const parts = path.split('/').filter(p => p)
    let currentNode: ExplorerNode = root
    parts.forEach((part, idx) => {
      const isFile = idx === parts.length - 1
      if (!currentNode.children.has(part)) {
        currentNode.children.set(part, {
          name: part,
          type: isFile ? 'file' : 'folder',
          children: new Map(),
          route: isFile ? { type: info.type, file: info.file, path } : '',
        } as ExplorerNode)
      }
      currentNode = currentNode.children.get(part)!
    })
  }

  for (const childNode of root.children.values()) {
    collapseExplorerTree(childNode)
  }

  return root
}

function renderExplorerTree(node: ExplorerNode, depth: number = 0): string {
  if (node.type !== 'folder') return ''

  const sortedKeys = Array.from(node.children.keys()).sort((a, b) => {
    const childA = node.children.get(a)!
    const childB = node.children.get(b)!
    if (childA.type !== childB.type) {
      return childA.type === 'folder' ? -1 : 1
    }
    return a.localeCompare(b)
  })

  let html = ''
  sortedKeys.forEach(key => {
    const child = node.children.get(key)!
    const indent = depth * 12
    if (child.type === 'folder') {
      const safeName = child.name.replace(/[^a-zA-Z0-9]/g, '-')
      const folderId = `folder-${safeName}-${depth}-${Math.random().toString(36).substring(2, 7)}`
      html += `
        <li class="explorer-item explorer-folder" data-folder-id="${folderId}" onclick="toggleExplorerFolder('${folderId}', event)" style="padding-left: ${indent}px;">
          <iconify-icon icon="lucide:chevron-down" class="folder-chevron" style="font-size: 0.85rem; margin-right: 0.15rem; transition: transform 0.15s;"></iconify-icon>
          <iconify-icon icon="vscode-icons:default-folder" class="folder-icon" style="font-size: 1.1rem; margin-right: 0.35rem;"></iconify-icon>
          <span class="explorer-name">${child.name}</span>
        </li>
        <ul id="${folderId}" class="explorer-folder-content" style="display: block; list-style: none; padding: 0; margin: 0;">
          ${renderExplorerTree(child, depth + 1)}
        </ul>
      `
    } else {
      const route = child.route
      const ext = route.file.split('.').pop() || ''
      let icon = 'gcp:api'

      icon = match(ext, {
        ts: 'vscode-icons:file-type-typescript',
        tsx: 'vscode-icons:file-type-reactts',
        html: 'vscode-icons:file-type-html',
        css: 'vscode-icons:file-type-css',
        json: 'vscode-icons:file-type-json',
        [match]: icon,
      })

      html += `
        <li class="explorer-item explorer-file" onclick="selectExplorerFile('${route.path}', this, event)" style="padding-left: ${indent + 12}px;">
          <iconify-icon icon="${icon}" style="font-size: 1.1rem; margin-right: 0.35rem;"></iconify-icon>
          <span class="explorer-name">${child.name}</span>
          <span class="explorer-route-badge ${route.type}">${route.type}</span>
        </li>
      `
    }
  })
  return html
}

export function toggleExplorerFolder(folderId: string, event: MouseEvent) {
  event.stopPropagation()
  const folderEl = document.querySelector(
    `.explorer-folder[data-folder-id="${folderId}"]`,
  )
  const contentEl = document.getElementById(folderId)
  if (!contentEl || !folderEl) return

  const isCollapsed = folderEl.classList.toggle('collapsed')
  contentEl.style.display = isCollapsed ? 'none' : 'block'

  const folderIcon = folderEl.querySelector('.folder-icon') as any
  if (folderIcon) {
    folderIcon.setAttribute(
      'icon',
      isCollapsed
        ? 'vscode-icons:default-folder'
        : 'vscode-icons:default-folder-opened',
    )
  }
}

export function selectExplorerFile(
  routePath: string,
  element: HTMLElement,
  event: MouseEvent,
) {
  event.stopPropagation()
  const route = registeredRoutes[routePath]
  if (!route) return

  selectRoute({ ...route, path: routePath }, element)
}

export async function loadRoutes() {
  const list = document.getElementById('routes-list')
  if (!list) return
  list.innerHTML =
    '<li class="results-empty" style="padding: 1rem 0;">Scanning paths...</li>'

  try {
    const res = await fetch('/api/_dashboard/routes')
    const json = await res.json()

    if (json.status !== 200 || !json.data || json.data.length === 0) {
      list.innerHTML =
        '<li class="results-empty" style="padding: 1rem 0;">No routes found</li>'
      return
    }

    registeredRoutes = json.data
    const tree = buildExplorerTree(registeredRoutes)
    list.innerHTML = renderExplorerTree(tree)
  } catch (_err) {
    list.innerHTML =
      '<li class="results-empty" style="padding: 1rem 0;">Error scanning routes</li>'
  }
}

export function setCustomSelectOptions(
  options: string[],
  disabled: boolean = false,
) {
  const selectEl = document.getElementById(
    'sandbox-method',
  ) as HTMLSelectElement | null

  if (selectEl) {
    selectEl.disabled = disabled
    selectEl.innerHTML = ''

    options.forEach(optVal => {
      const opt = document.createElement('option')
      opt.value = optVal
      opt.textContent = optVal
      selectEl.appendChild(opt)
    })

    if (options.length > 0) {
      selectEl.value = options[0]
      onSandboxMethodChange(options[0])
      updateAdvancedSectionVisibility()
      updateSandboxUrlPreview()
    }
  }
}

export function isBlobSupported(): boolean {
  const methodEl = document.getElementById(
    'sandbox-method',
  ) as HTMLInputElement | null
  const method = methodEl ? methodEl.value : 'GET'
  return ['POST', 'PUT', 'PATCH'].includes(method)
}

export function updateAdvancedSectionVisibility() {
  const methodEl = document.getElementById(
    'sandbox-method',
  ) as HTMLInputElement | null
  const method = methodEl ? methodEl.value : 'GET'
  const advSec = document.getElementById('sandbox-advanced-sec')
  if (advSec) {
    if (
      ['POST', 'PUT', 'PATCH'].includes(method) &&
      activeSelectedRouteObj &&
      activeSelectedRouteObj.type !== 'page' &&
      activeSelectedRouteObj.type !== 'error'
    ) {
      advSec.style.display = 'flex'
    } else {
      advSec.style.display = 'none'
    }
  }
}

export function onSandboxMethodChange(method: string) {
  const supportsBlob = ['POST', 'PUT', 'PATCH'].includes(method)
  const rows = document.querySelectorAll('.sandbox-param-row')
  rows.forEach(row => {
    const typeSelect = row.querySelector<HTMLSelectElement>(
      '.sandbox-param-type',
    )

    const blobOption = typeSelect?.querySelector<HTMLOptionElement>(
      'option[value="blob"]',
    )

    if (!blobOption || !typeSelect) return
    if (supportsBlob) {
      blobOption.removeAttribute('disabled')
      return
    }

    blobOption.setAttribute('disabled', 'true')
    if (typeSelect.value === 'blob') {
      typeSelect.value = 'string'
      onParameterTypeChange(typeSelect)
    }
  })
}

export function onParameterTypeChange(selectEl: HTMLSelectElement) {
  const row = selectEl.closest('.sandbox-param-row') as HTMLElement
  const valContainer = row?.querySelector('.sandbox-param-val-container')
  if (!valContainer || !row) return

  valContainer.innerHTML =
    selectEl.value === 'blob'
      ? `<input type="file" class="sandbox-param-val-file" onchange="updateSandboxUrlPreview()" style="width: 100%; font-family: monospace; font-size: 0.85rem; color: var(--text-secondary);" />`
      : `<input type="text" class="sandbox-param-val" placeholder="Value" oninput="updateSandboxUrlPreview()" style="width: 100%; padding: 0.35rem 0.5rem; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 0.25rem; color: var(--text-primary); font-family: monospace; font-size: 0.85rem;" />`

  updateSandboxUrlPreview()
}

export function addSandboxParameter(
  name: string = '',
  type: 'string' | 'blob' = 'string',
  value: string = '',
) {
  const paramsList = document.getElementById('sandbox-params-list')
  if (!paramsList) return

  const row = document.createElement('div')
  row.className = 'sandbox-param-row'
  row.style.display = 'grid'
  row.style.gridTemplateColumns = '2fr 1.5fr 3fr 40px'
  row.style.gap = '0.5rem'
  row.style.alignItems = 'center'

  const blobDisabled = !isBlobSupported()

  row.innerHTML = `
    <div>
      <input type="text" class="sandbox-param-name" placeholder="Param name" value="${name}" oninput="updateSandboxUrlPreview()" style="width: 100%; padding: 0.35rem 0.5rem; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 0.25rem; color: var(--text-primary); font-family: monospace; font-size: 0.85rem;" />
    </div>
    <div>
      <select class="sandbox-param-type" onchange="onParameterTypeChange(this)">
        <option value="string" ${type === 'string' ? 'selected' : ''}>string</option>
        <option value="blob" ${type === 'blob' ? 'selected' : ''} ${blobDisabled ? 'disabled' : ''}>blob</option>
      </select>
    </div>
    <div class="sandbox-param-val-container" style="display: flex; align-items: center; width: 100%;">
      ${
        type === 'blob'
          ? `<input type="file" class="sandbox-param-val-file" onchange="updateSandboxUrlPreview()" style="width: 100%; font-family: monospace; font-size: 0.85rem; color: var(--text-secondary);" />`
          : `<input type="text" class="sandbox-param-val" placeholder="Value" value="${value}" oninput="updateSandboxUrlPreview()" style="width: 100%; padding: 0.35rem 0.5rem; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 0.25rem; color: var(--text-primary); font-family: monospace; font-size: 0.85rem;" />`
      }
    </div>
    <div style="display: flex; justify-content: center;">
      <button class="btn btn-danger" onclick="removeSandboxParameter(this)" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background: var(--accent-red); box-shadow: none; border-radius: 0.25rem; display: inline-flex; align-items: center; justify-content: center;">
        <iconify-icon icon="lucide:x" style="font-size: 0.95rem;"></iconify-icon>
      </button>
    </div>
  `

  paramsList.appendChild(row)
  updateSandboxUrlPreview()
}

export function removeSandboxParameter(btn: HTMLElement) {
  btn.closest('.sandbox-param-row')?.remove()
  updateSandboxUrlPreview()
}

function setupSandboxUI(route: any, isRenderable: boolean) {
  const emptyEl = document.getElementById('sandbox-empty')
  const runnerEl = document.getElementById('sandbox-runner')
  const titleEl = document.getElementById('sandbox-title')
  if (emptyEl) emptyEl.style.display = 'none'
  if (runnerEl) runnerEl.style.display = 'flex'
  if (titleEl) titleEl.innerText = `API Sandbox: ${route.path}`

  const urlInput = document.getElementById(
    'sandbox-url',
  ) as HTMLInputElement | null
  if (urlInput) urlInput.value = route.path

  isRenderable
    ? setCustomSelectOptions(['GET'], true)
    : setCustomSelectOptions(['GET', 'POST', 'PUT', 'DELETE'], false)

  const toggle = document.getElementById('sandbox-view-toggle')
  const previewFrame = document.getElementById(
    'sandbox-preview-frame',
  ) as HTMLIFrameElement | null
  const responseEl = document.getElementById('sandbox-response')
  if (toggle) toggle.style.display = 'none'
  if (previewFrame) previewFrame.style.display = 'none'
  if (responseEl) responseEl.style.display = 'block'
  switchSandboxView('code')
}

function extractSandboxParams(route: any) {
  const params: string[] = []
  const matches = route.path.match(/\[([^\]]+)\]/g)

  for (const m of matches || []) params.push(m.slice(1, -1))

  const paramsList = document.getElementById('sandbox-params-list')
  if (paramsList) {
    paramsList.innerHTML = ''
    for (const p of params) addSandboxParameter(p, 'string')
  }
}

export function selectRoute(route: any, element: HTMLElement) {
  document
    .querySelectorAll('.route-item, .explorer-file')
    .forEach(el => { el.classList.remove('selected') })
  element.classList.add('selected')

  activeSelectedRouteObj = route
  sandboxLastHtml = ''

  const isRenderable = route.type === 'page' || route.type === 'error'
  setupSandboxUI(route, isRenderable)
  extractSandboxParams(route)

  const methodEl = document.getElementById(
    'sandbox-method',
  ) as HTMLInputElement | null
  const method = methodEl ? methodEl.value : 'GET'
  onSandboxMethodChange(method)
  updateAdvancedSectionVisibility()
  updateSandboxUrlPreview()

  if (isRenderable) {
    void sendSandboxRequest()
  }
}

type ParamRowValues = {
  name: string
  val: string
  isPathParam: boolean
  typeEl: HTMLSelectElement | null
}

function getParamRowValues(row: Element): ParamRowValues {
  const nameEl = row.querySelector<HTMLInputElement>('.sandbox-param-name')
  const typeEl = row.querySelector<HTMLSelectElement>('.sandbox-param-type')
  const fileEl = row.querySelector<HTMLInputElement>('.sandbox-param-val-file')
  const valEl = row.querySelector<HTMLInputElement>('.sandbox-param-val')
  const name = nameEl?.value.trim() ?? ''
  const val = valEl
    ? (valEl.value ?? '')
    : fileEl?.files?.[0]
      ? fileEl.files[0].name
      : ''
  return { name, val, isPathParam: false, typeEl }
}

function buildUrlFromRows(
  basePath: string,
  rows: NodeListOf<Element>,
  method: string,
): string | null {
  let path = basePath
  const queryParams: string[] = []

  for (const row of rows) {
    const { name, val } = getParamRowValues(row)
    if (!name) return null

    const placeholder = `[${name}]`
    if (path.includes(placeholder)) {
      path = path.replace(placeholder, val || placeholder)
      continue
    }

    if (!['GET', 'DELETE'].includes(method)) return null
    if (!val) continue

    queryParams.push(`${encodeURIComponent(name)}=${encodeURIComponent(val)}`)
  }

  return queryParams.length > 0 ? `${path}?${queryParams.join('&')}` : path
}

export function updateSandboxUrlPreview() {
  if (!activeSelectedRouteObj) return

  const el: Record<string, HTMLInputElement | null> = {
    method: document.getElementById('sandbox-method') as HTMLInputElement,
    url: document.getElementById('sandbox-url') as HTMLInputElement,
  }

  const method = el.method?.value ?? 'GET'
  const rows = document.querySelectorAll('.sandbox-param-row')
  const result = buildUrlFromRows(activeSelectedRouteObj.path, rows, method)

  if (result !== null && el.url) el.url.value = result
}

export function switchSandboxView(view: 'code' | 'preview') {
  sandboxCurrentView = view
  const codeBtn = document.getElementById('sandbox-view-code')
  const previewBtn = document.getElementById('sandbox-view-preview')
  const responseEl = document.getElementById('sandbox-response')
  const previewFrame = document.getElementById(
    'sandbox-preview-frame',
  ) as HTMLIFrameElement | null

  if (codeBtn) codeBtn.classList.toggle('active', view === 'code')
  if (previewBtn) previewBtn.classList.toggle('active', view === 'preview')

  if (view === 'code') {
    if (responseEl) responseEl.style.display = 'block'
    if (previewFrame) previewFrame.style.display = 'none'
  } else {
    if (responseEl) responseEl.style.display = 'none'
    if (previewFrame) {
      previewFrame.style.display = 'block'
      if (sandboxLastHtml) {
        previewFrame.srcdoc = sandboxLastHtml
      }
    }
  }
}

function buildFormDataBody(rows: NodeListOf<Element>): FormData {
  const formData = new FormData()
  for (const row of rows) {
    const el: Record<string, HTMLInputElement> = {
      name: row.querySelector('.sandbox-param-name') as HTMLInputElement,
      type: row.querySelector('.sandbox-param-type') as HTMLInputElement,
      file: row.querySelector('.sandbox-param-val-file') as HTMLInputElement,
      val: row.querySelector('.sandbox-param-val') as HTMLInputElement,
    }

    const name = el.name?.value.trim()
    const placeholder = `[${name}]`
    if (!name) continue

    if (activeSelectedRouteObj.path.includes(placeholder)) continue
    if (el.file?.files?.[0]) {
      formData.append(name, el.file.files[0])
      continue
    }

    formData.append(name, el.val ? el.val.value : '')
  }
  return formData
}

function buildJsonBody(
  rows: NodeListOf<Element>,
  headers: Record<string, string>,
): any {
  const bodyObj: Record<string, any> = {}

  for (const row of rows) {
    const el: Record<string, HTMLInputElement> = {
      name: row.querySelector('.sandbox-param-name') as HTMLInputElement,
      val: row.querySelector('.sandbox-param-val') as HTMLInputElement,
    }

    const name = el.name?.value.trim()
    const placeholder = `[${name}]`
    if (!name) continue

    if (activeSelectedRouteObj.path.includes(placeholder)) continue

    bodyObj[name] = el.val ? el.val.value : ''
  }

  const bodyEl = document.getElementById(
    'sandbox-body',
  ) as HTMLTextAreaElement | null
  const rawBody = bodyEl?.value.trim() ?? ''

  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody)
      Object.assign(bodyObj, parsed)
    } catch (_e) {
      throw new Error('Invalid Advanced JSON body')
    }
  }

  if (Object.keys(bodyObj).length > 0 || rawBody) {
    headers['Content-Type'] = 'application/json'
    return JSON.stringify(bodyObj, null, 2)
  }
  return undefined
}

function buildSandboxBody(
  method: string,
  rows: NodeListOf<Element>,
  headers: Record<string, string>,
): any {
  if (
    !['POST', 'PUT', 'PATCH'].includes(method) ||
    activeSelectedRouteObj.type === 'page' ||
    activeSelectedRouteObj.type === 'error'
  ) {
    return undefined
  }

  let hasBlob = false
  for (const row of rows) {
    const typeEl = row.querySelector<HTMLSelectElement>('.sandbox-param-type')
    if (typeEl?.value === 'blob') hasBlob = true
  }

  if (hasBlob) {
    return buildFormDataBody(rows)
  }
  return buildJsonBody(rows, headers)
}

async function applyJsonResponse(
  res: Response,
  responseContainer: HTMLElement,
) {
  const json = await res.json()
  responseContainer.innerText = JSON.stringify(json, null, 2)
  responseContainer.style.color = '#a5f3fc'
  const toggle = document.getElementById('sandbox-view-toggle')
  if (toggle) toggle.style.display = 'none'
  sandboxLastHtml = ''
  switchSandboxView('code')
}

function applyHtmlToggle(text: string, contentType: string) {
  const isHtml =
    contentType.includes('text/html') || text.trim().startsWith('<')
  const toggle = document.getElementById('sandbox-view-toggle')
  if (isHtml && toggle) {
    sandboxLastHtml = text
    toggle.style.display = 'inline-flex'
    if (
      activeSelectedRouteObj &&
      (activeSelectedRouteObj.type === 'page' ||
        activeSelectedRouteObj.type === 'error')
    ) {
      switchSandboxView('preview')
    }
  } else {
    if (toggle) toggle.style.display = 'none'
    sandboxLastHtml = ''
  }
}

async function handleSandboxFetchResponse(
  res: Response,
  responseContainer: HTMLElement,
) {
  const contentType = res.headers.get('Content-Type') || ''
  if (contentType.includes('application/json')) {
    await applyJsonResponse(res, responseContainer)
  } else {
    const text = await res.text()
    responseContainer.innerText = text
    responseContainer.style.color = '#cbd5e1'
    applyHtmlToggle(text, contentType)
  }
}

async function executeSandboxFetch(
  path: string,
  method: string,
  headers: Record<string, string>,
  body: any,
  start: number,
  meta: HTMLElement | null,
  responseContainer: HTMLElement | null,
) {
  try {
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['X-Requested-With'] = 'XMLHttpRequest'
    }
    const res = await fetch(path, { method, headers, body })
    const duration = (performance.now() - start).toFixed(1)

    if (meta)
      meta.innerText = `STATUS: ${res.status} ${res.statusText} | ${duration}ms`

    if (responseContainer) {
      await handleSandboxFetchResponse(res, responseContainer)
    }
  } catch (err: any) {
    const duration = (performance.now() - start).toFixed(1)
    if (meta) meta.innerText = `FAILED | ${duration}ms`
    if (responseContainer) {
      responseContainer.innerText = `Network error: ${err.message}`
      responseContainer.style.color = '#ef4444'
    }
  }
}

export async function sendSandboxRequest() {
  if (!activeSelectedRouteObj) return

  const el: Record<string, HTMLInputElement | null> = {
    method: document.getElementById('sandbox-method') as HTMLInputElement,
    url: document.getElementById('sandbox-url') as HTMLInputElement,
  }

  const path = el.url?.value ?? ''
  const method = el.method?.value ?? 'GET'
  const meta = document.getElementById('sandbox-meta')
  const responseContainer = document.getElementById('sandbox-response')

  if (meta) meta.innerText = 'Executing...'
  if (responseContainer) responseContainer.innerText = 'Sending request...'

  const rows = document.querySelectorAll('.sandbox-param-row')
  const headers: Record<string, string> = {}
  let body: any

  try {
    body = buildSandboxBody(method, rows, headers)
  } catch (e: any) {
    alert(e.message)
    if (meta) meta.innerText = 'Error'
    if (responseContainer)
      responseContainer.innerText =
        'Invalid JSON request body format in Custom (Advanced).'
    return
  }

  const start = performance.now()
  await executeSandboxFetch(
    path,
    method,
    headers,
    body,
    start,
    meta,
    responseContainer,
  )
}

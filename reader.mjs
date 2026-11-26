import { getDocument, GlobalWorkerOptions } from './vendor/pdfjs/pdf.min.mjs'

GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href

function createPane(versions, selected) {
  const pane = document.createElement('section')
  pane.innerHTML = `<div class="pdf-controls">
    <label>刊本 <select></select></label>
    <button type="button" data-step="-1">上一页</button>
    <label>页码 <input type="number" min="1" value="1"></label>
    <output></output>
    <button type="button" data-step="1">下一页</button>
    <a target="_blank" rel="noopener">打开 PDF</a>
  </div><p role="status"></p><canvas aria-label="影印页"></canvas>`
  const select = pane.querySelector('select')
  versions.forEach(({ edition, file }) => select.add(new Option(edition, file)))
  select.selectedIndex = selected
  const input = pane.querySelector('input')
  const canvas = pane.querySelector('canvas')
  const status = pane.querySelector('[role=status]')
  const link = pane.querySelector('a')
  const counter = pane.querySelector('output')
  const [previous, next] = pane.querySelectorAll('button')
  let loading, documentPdf, render
  let version = 0
  let pageRequest = 0

  function controls() {
    const page = Number(input.value)
    input.disabled = !documentPdf
    previous.disabled = !documentPdf || page <= 1
    next.disabled = !documentPdf || page >= documentPdf.numPages
    counter.value = documentPdf ? `/ ${documentPdf.numPages}` : ''
  }

  async function showPage(number) {
    if (!documentPdf) return
    const request = ++pageRequest
    input.value = Math.max(1, Math.min(documentPdf.numPages, number || 1))
    controls()
    render?.cancel()
    try {
      const page = await documentPdf.getPage(Number(input.value))
      if (request !== pageRequest) return
      const scale = Math.min(2.5, Math.max(1, (pane.clientWidth - 12) * devicePixelRatio / page.getViewport({ scale: 1 }).width))
      const viewport = page.getViewport({ scale })
      const target = document.createElement('canvas')
      target.width = Math.ceil(viewport.width)
      target.height = Math.ceil(viewport.height)
      render = page.render({ canvasContext: target.getContext('2d'), viewport })
      await render.promise
      if (request !== pageRequest) return
      canvas.width = target.width
      canvas.height = target.height
      canvas.getContext('2d').drawImage(target, 0, 0)
      canvas.dataset.page = input.value
      canvas.hidden = false
      status.textContent = ''
    } catch (error) {
      if (request === pageRequest && error.name !== 'RenderingCancelledException') status.textContent = '无法显示本页，可直接打开 PDF。'
    }
  }

  async function openVersion() {
    const request = ++version
    ++pageRequest
    render?.cancel()
    loading?.destroy().catch(() => {})
    documentPdf = null
    controls()
    canvas.hidden = true
    status.textContent = '正在加载影印…'
    link.href = select.value
    try {
      loading = getDocument({ url: link.href })
      const pdf = await loading.promise
      if (request !== version) return
      documentPdf = pdf
      input.max = pdf.numPages
      await showPage(1)
    } catch {
      if (request === version) status.textContent = '无法加载影印，可直接打开 PDF。'
    }
  }

  select.addEventListener('change', openVersion)
  input.addEventListener('change', () => showPage(Number(input.value)))
  previous.addEventListener('click', () => showPage(Number(input.value) - 1))
  next.addEventListener('click', () => showPage(Number(input.value) + 1))
  return { pane, openVersion, close() {
    ++version
    ++pageRequest
    render?.cancel()
    loading?.destroy().catch(() => {})
    documentPdf = null
  } }
}

for (const reader of document.querySelectorAll('[data-facsimile]')) {
  reader.addEventListener('toggle', async () => {
    if (!reader.open || reader.querySelector('dialog')) return
    const versions = JSON.parse(reader.dataset.facsimile)
    const dialog = document.createElement('dialog')
    dialog.className = 'facsimile-dialog'
    dialog.innerHTML = '<div class="pdf-controls"><button type="button" data-close>关闭</button><label data-compare><input type="checkbox">双栏对照</label></div><div class="facsimile-panes"></div>'
    reader.append(dialog)
    const panes = dialog.querySelector('.facsimile-panes')
    const compare = dialog.querySelector('[data-compare]')
    compare.hidden = versions.length < 2
    const checkbox = compare.querySelector('input')
    const left = createPane(versions, 0)
    panes.append(left.pane)
    let right
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        right = createPane(versions, 1)
        panes.append(right.pane)
        right.openVersion()
      } else {
        right.close()
        right.pane.remove()
        right = null
      }
    })
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close())
    dialog.addEventListener('close', () => {
      left.close()
      right?.close()
      dialog.remove()
      reader.open = false
    })
    dialog.showModal()
    left.openVersion()
  })
}

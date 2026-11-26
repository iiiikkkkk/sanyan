import { getDocument, GlobalWorkerOptions } from './vendor/pdfjs/pdf.min.mjs'

GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href

function createScan(container, versions, selected) {
  const pane = document.querySelector('#scan-pane').content.firstElementChild.cloneNode(true)
  container.append(pane)
  const select = pane.querySelector('.edition')
  const zoom = pane.querySelector('.zoom')
  const stage = pane.querySelector('.scan-stage')
  const form = pane.querySelector('.page-form')
  const input = form.querySelector('input')
  const counter = form.querySelector('output')
  const [previous, next] = pane.querySelectorAll('[data-step]')
  const canvas = stage.querySelector('canvas')
  const status = stage.querySelector('.scan-status')
  const link = pane.querySelector('.pdf-link')

  versions.forEach(({ edition, file }) => select.add(new Option(edition, file)))
  select.selectedIndex = selected
  let loading
  let pdf
  let render
  let frame
  let requestId = 0
  let versionId = 0
  let pageNumber = 1
  let lastWidth = 0

  function updateControls() {
    input.value = pageNumber
    input.disabled = !pdf
    zoom.disabled = !pdf
    previous.disabled = !pdf || pageNumber <= 1
    next.disabled = !pdf || pageNumber >= pdf.numPages
    counter.value = pdf ? `/ ${pdf.numPages}` : ''
  }

  function cancelRender() {
    cancelAnimationFrame(frame)
    render?.cancel()
    ++requestId
  }

  async function renderPage() {
    if (!pdf || !stage.clientWidth) return
    cancelRender()
    const currentRequest = requestId
    try {
      const page = await pdf.getPage(pageNumber)
      if (currentRequest !== requestId) return
      const nativeWidth = page.getViewport({ scale: 1 }).width
      const style = getComputedStyle(stage)
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      const available = Math.max(1, stage.clientWidth - padding)
      const width = available * Number(zoom.value)
      const scale = Math.min(width * devicePixelRatio, 3600) / nativeWidth
      const viewport = page.getViewport({ scale })
      const target = document.createElement('canvas')
      target.width = Math.ceil(viewport.width)
      target.height = Math.ceil(viewport.height)
      render = page.render({ canvasContext: target.getContext('2d'), viewport })
      await render.promise
      if (currentRequest !== requestId) return
      canvas.width = target.width
      canvas.height = target.height
      canvas.style.width = `${width}px`
      canvas.getContext('2d').drawImage(target, 0, 0)
      canvas.dataset.page = pageNumber
      canvas.setAttribute('aria-label', `${select.selectedOptions[0].text}，第 ${pageNumber} 页`)
      canvas.hidden = false
      status.textContent = ''
    } catch (error) {
      if (currentRequest === requestId && error.name !== 'RenderingCancelledException') {
        canvas.hidden = true
        status.textContent = '无法显示这一页。可通过「打开 PDF」直接阅读。'
      }
    }
  }

  function goTo(number) {
    if (!pdf) return
    const destination = Math.max(1, Math.min(pdf.numPages, Math.trunc(number) || 1))
    if (destination === pageNumber) {
      input.value = pageNumber
      return
    }
    pageNumber = destination
    stage.scrollTop = 0
    updateControls()
    renderPage()
  }

  async function openVersion() {
    const currentVersion = ++versionId
    cancelRender()
    loading?.destroy().catch(() => {})
    pdf = null
    pageNumber = 1
    delete canvas.dataset.page
    canvas.hidden = true
    status.textContent = '正在加载影印…'
    link.href = select.value
    updateControls()
    stage.scrollTop = 0
    try {
      loading = getDocument({ url: link.href })
      const nextPdf = await loading.promise
      if (currentVersion !== versionId) return
      pdf = nextPdf
      input.max = pdf.numPages
      updateControls()
      renderPage()
    } catch {
      if (currentVersion === versionId) status.textContent = '无法加载影印。可通过「打开 PDF」直接阅读。'
    }
  }

  const resize = new ResizeObserver(() => {
    if (stage.clientWidth === lastWidth) return
    lastWidth = stage.clientWidth
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(renderPage)
  })
  resize.observe(stage)
  select.addEventListener('change', openVersion)
  zoom.addEventListener('change', renderPage)
  form.addEventListener('submit', event => {
    event.preventDefault()
    goTo(input.valueAsNumber)
  })
  input.addEventListener('change', () => goTo(input.valueAsNumber))
  previous.addEventListener('click', () => goTo(pageNumber - 1))
  next.addEventListener('click', () => goTo(pageNumber + 1))
  stage.addEventListener('keydown', event => {
    if (!pdf || !['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    goTo(pageNumber + (event.key === 'ArrowRight' ? 1 : -1))
  })
  openVersion()
}

async function getResource(path, format) {
  const response = await fetch(path)
  if (!response.ok) throw Error(`无法读取 ${path}`)
  return response[format]()
}

function showContents(books, active) {
  const nav = document.querySelector('#story-list')
  for (const book of books) {
    const group = document.createElement('section')
    const heading = document.createElement('h2')
    heading.textContent = book.querySelector('.cover').textContent.trim()
    const list = document.createElement('ul')
    for (const story of book.querySelectorAll(':scope > .story')) {
      const item = document.createElement('li')
      const link = document.createElement('a')
      link.href = `read.html?story=${encodeURIComponent(story.id)}`
      link.textContent = story.querySelector('summary').textContent.trim()
      if (story === active) link.setAttribute('aria-current', 'page')
      item.append(link)
      list.append(item)
    }
    group.append(heading, list)
    nav.append(group)
  }
  if (matchMedia('(max-width: 900px)').matches) document.querySelector('#contents').open = false
}

function showIllustrations(story) {
  const panel = document.querySelector('#illustrations')
  const image = panel.querySelector('figure img')
  const caption = panel.querySelector('figcaption')
  const strip = panel.querySelector('.illustration-strip')
  const enlarge = panel.querySelector('#enlarge-illustration')
  const dialog = document.querySelector('.illustration-dialog')
  const enlarged = dialog.querySelector('img')
  const plates = [...story.querySelectorAll('.gallery .plate')].flatMap(plate => {
    const picture = plate.querySelector('img')
    const file = picture?.getAttribute('src')
    if (!file || !/^plate-[a-f0-9]+\.jpg$/.test(file)) return []
    return [{
      file,
      title: plate.querySelector('h3')?.textContent.trim() || picture.alt,
      credit: plate.querySelector('small')?.textContent.trim()
    }]
  })
  const thumbnails = plates.map(({ file, title }) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.title = title
    button.setAttribute('aria-label', title)
    const thumbnail = new Image()
    thumbnail.alt = ''
    thumbnail.loading = 'lazy'
    thumbnail.src = file
    button.append(thumbnail)
    strip.append(button)
    return button
  })

  function selectPlate(index) {
    const { file, title, credit } = plates[index]
    image.src = file
    image.alt = title
    image.hidden = false
    caption.textContent = title
    if (credit) {
      const source = document.createElement('small')
      source.textContent = credit
      caption.append(source)
    }
    thumbnails.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)))
  }

  thumbnails.forEach((button, index) => button.addEventListener('click', () => selectPlate(index)))
  enlarge.addEventListener('click', () => {
    enlarged.src = image.src
    enlarged.alt = image.alt
    dialog.showModal()
  })
  if (plates.length) {
    selectPlate(0)
  } else {
    panel.querySelector('.empty-illustrations').hidden = false
    enlarge.hidden = true
    strip.hidden = true
  }
}

async function start() {
  const [html, catalog] = await Promise.all([
    getResource('index.html', 'text'),
    getResource('facsimiles.json', 'json')
  ])
  const library = new DOMParser().parseFromString(html, 'text/html')
  const id = new URLSearchParams(location.search).get('story') || Object.keys(catalog)[0]
  const story = library.getElementById(id)
  const roomStatus = document.querySelector('#room-status')
  showContents(library.querySelectorAll('.book'), story)
  const versions = Object.hasOwn(catalog, id) ? catalog[id] : []
  if (!story?.matches('.story') || !versions.length) {
    roomStatus.textContent = '找不到这个篇目。请在目录中选择一篇。'
    document.querySelector('#contents').open = true
    return
  }
  const title = story.querySelector('summary').textContent.trim()
  document.title = `${title} · 三言图文数据库`
  document.querySelector('#book-name').textContent = story.closest('.book').querySelector('.cover').textContent.trim()
  document.querySelector('#story-title').textContent = title
  document.querySelector('#story-link').href = `index.html#${encodeURIComponent(id)}`
  const article = document.querySelector('#story-text')
  for (const paragraph of story.querySelector('pre').textContent.trim().split(/\n\s*\n/)) {
    const element = document.createElement('p')
    element.textContent = paragraph
    article.append(element)
  }
  document.querySelector('#text-size').addEventListener('change', event => {
    article.dataset.size = event.target.value
  })

  showIllustrations(story)
  const panes = document.querySelector('#reading-panes')
  const primary = document.querySelector('#primary-scan')
  const secondary = document.querySelector('#secondary-scan')
  const modeButtons = [...document.querySelectorAll('[data-mode][aria-pressed]')]
  const panelsByMode = {
    parallel: ['illustrations', 'transcript'],
    illustrations: ['illustrations'],
    'illustrated-scan': ['illustrations', 'primary-scan'],
    scan: ['primary-scan'],
    'scan-text': ['primary-scan', 'transcript'],
    text: ['transcript'],
    editions: ['primary-scan', 'secondary-scan']
  }
  document.querySelector('button[data-mode="editions"]').hidden = versions.length < 2

  function setMode(mode) {
    const visiblePanels = panelsByMode[mode]
    panes.dataset.mode = mode
    for (const panel of panes.children) panel.hidden = !visiblePanels.includes(panel.id)
    if (!primary.hidden && !primary.firstElementChild) createScan(primary, versions, 0)
    if (!secondary.hidden && !secondary.firstElementChild) createScan(secondary, versions, 1)
    for (const choice of modeButtons) choice.setAttribute('aria-pressed', String(choice.dataset.mode === mode))
    for (const link of document.querySelectorAll('#story-list a')) {
      const target = new URL(link.href)
      if (mode === 'parallel') target.searchParams.delete('view')
      else target.searchParams.set('view', mode)
      link.href = target.href
    }
  }

  const requested = new URL(location.href).searchParams.get('view')
  const initialMode = modeButtons.some(button => !button.hidden && button.dataset.mode === requested) ? requested : 'parallel'
  roomStatus.textContent = ''
  panes.hidden = false
  setMode(initialMode)
  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode
      setMode(mode)
      const url = new URL(location.href)
      if (mode === 'parallel') url.searchParams.delete('view')
      else url.searchParams.set('view', mode)
      history.replaceState(null, '', url)
    })
  }
}

start().catch(() => {
  document.querySelector('#room-status').textContent = '暂时无法加载篇目。请刷新页面，或返回首页直接打开 PDF。'
})

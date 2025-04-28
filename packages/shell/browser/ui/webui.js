ko.bindingHandlers.rendered = {
  init: function (element, valueAccessor) {
    //console.log("rendered: ", valueAccessor())
    valueAccessor()()
  },
}

ko.bindingHandlers['style'] = {
  update: function (element, valueAccessor) {
    var value = ko.utils.unwrapObservable(valueAccessor() || {})
    ko.utils.objectForEach(value, function (styleName, styleValue) {
      styleValue = ko.utils.unwrapObservable(styleValue)

      if (styleValue === null || styleValue === undefined || styleValue === false) {
        // Empty string removes the value, whereas null/undefined have no effect
        styleValue = ''
      }

      if (styleName.substring(0, 2) === '--') {
        element.style.setProperty(styleName, styleValue)
      } else {
        element.style[styleName] = styleValue
      }
    })
  },
}

class WebUITab {
  inputUrl = ko.observable()
}

class WebUI {
  windowId = ko.observable(-1)

  theme = ko.observable('andra')
  brightness = ko.observable('system')

  tabs = ko.observableArray([])
  activeTab = ko.pureComputed(() =>
    this.activeTabId() > 0 ? this.tabs().find((t) => t.id === this.activeTabId()) : null,
  )

  downloads = ko.observableArray([])
  downloadPct = ko.observable(0)
  bytesReceived = ko.observable(0)
  bytesTotal = ko.observable()

  activeTabId = ko.observable(-1)
  heldTabId = -1
  closingTabId = -1
  hoveringTabId = -1
  topbarHeight = 0

  windowState = ko.observable()

  platform = navigator.userAgentData.platform.toLowerCase()
  settingsUrl = 'chrome-extension://' + chrome.runtime.id + '/settings.html'

  constructor() {
    ipc.on('webui-message', async (ev, msg) => {
      //console.log('>> from main: ', msg)
      if (msg?.type) await this.receiveFromMain(msg)
      else alert('webui.js received invalid webui-message from main:\n' + JSON.stringify(msg))
    })
    chrome.runtime.onMessage.addListener(
      function (msg, sender, sendresponse) {
        ;(async () => {
          //console.log('>> from renderer: ', msg)
          if (msg?.type) {
            try {
              const result = await this.receiveFromRenderer(msg)
              sendresponse({ result, complete: true })
            } catch (error) {
              alert(
                `webui.js encountered an error handling message from renderer\nError: ${error}\nMessage:${JSON.stringify(msg)}\n`,
              )
              sendresponse({ error, complete: false })
            }
          } else alert('webui.js received invalid message from renderer\n' + JSON.stringify(msg))
        })()
        return true
      }.bind(this),
    )
  }

  async init(windowId) {
    if (this.windowId() >= 0) return
    this.windowId(windowId)

    //console.log('>> init()', windowId)
    await this.initTheme()
    // wait for initial tab to load
    await sleep(100)
    await this.initTabs()

    var downloads = await chrome.downloads.search({})
    if (downloads.some((d) => d.state == 'in_progress')) {
      downloads = downloads.filter((d) => ['in_progress', 'complete'].includes(d.state))
      this.downloads(downloads)
    }
    this.updateDownloadStats()
  }

  async initTheme() {
    const theme = await this.sendToMain('get-config-item', { key: 'window.style.theme' })
    this.theme(theme)
    const brightness = await this.sendToMain('get-config-item', { key: 'window.style.brightness' })
    this.brightness(brightness)
  }

  async initTabs() {
    //console.log('>> initTabs()')
    await this.renderTabs()
    for (const tab of this.tabs()) await this.updateTabShouldHideAddressBar(tab)
    this.setupBrowserListeners()
  }

  async renderTabs() {
    //console.log('>> rendering tabs')
    const tabs = [...(await this.getCurrentTabs())]
    for (const tab of tabs)
      this.prepareTab(
        tab,
        this.tabs().find((t) => t.id == tab.id),
      )
    this.updateTabSeparators(tabs)
    this.tabs(tabs)

    // set a new active tab if previous one is invalid
    const activeTab = tabs.find((tab) => tab.active())
    const newId = activeTab?.id || tabs[0].id
    if ((this.activeTabId() == -1 || this.activeTabId() !== newId) && tabs.length > 0) {
      //console.log('reinitializing active tab', newId)
      this.activeTabId(newId)
    }
  }

  prepareTab(tab, oldTab) {
    if (!tab.separator) tab.separator = ko.observable(oldTab?.separator() ?? 'none')
    if (!tab.showAddressBar) tab.showAddressBar = ko.observable(oldTab?.showAddressBar() ?? false)
    if (!tab.urlInput)
      tab.urlInput = ko.observable(oldTab?.url != tab.url ? tab.url : oldTab.urlInput())
    if (typeof tab.active !== 'function') tab.active = ko.observable(tab.active)
  }

  async updateTabSeparators(tabs) {
    if (!tabs) return
    let foundActive = false
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i]
      foundActive = foundActive || tab.active()
      if (
        !tab.active() &&
        tab.id != this.hoveringTabId &&
        (i === tabs.length - 1 || (!tabs[i + 1].active() && tabs[i + 1].id != this.hoveringTabId))
      )
        tab.separator('right')
      else tab.separator('none')
    }
  }

  async updateTabShouldHideAddressBar(tab) {
    const shouldHideAddressBar = await this.sendToMain('get-should-hide-addressbar', {
      url: tab.url,
    })
    tab.showAddressBar(!shouldHideAddressBar)
  }

  async setTopbarObserver() {
    const resizeObserver = new ResizeObserver(async (entries) => {
      for (const entry of entries) {
        const height = entry.devicePixelContentBoxSize[0].blockSize
        const factor = window.devicePixelRatio
        if (height != this.topbarHeight) {
          this.topbarHeight = height
          await this.sendTopbarSize()
          await this.sendToMain('webui-zoom-changed', { height, factor })
        }
      }
    })
    resizeObserver.observe(document.getElementById('topbar-container'))
  }

  updateDownloadStats() {
    this.bytesReceived(this.downloads().reduce((sum, dl) => sum + dl.bytesReceived, 0))
    this.bytesTotal(
      this.downloads().length > 0
        ? this.downloads().reduce((sum, dl) => sum + dl.totalBytes, 0)
        : undefined,
    )
    this.downloadPct((this.bytesReceived() / this.bytesTotal()) * 100)
  }

  async setupBrowserListeners() {
    chrome.tabs.onCreated.addListener(async (tab) => {
      if (tab.windowId !== this.windowId()) return
      this.renderTabs()
      for (const t of this.tabs()) await this.updateTabShouldHideAddressBar(t)
    })
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, details) => {
      const tab = this.tabs().find((t) => t.id == tabId)
      if (!tab) return

      //console.log('>> updating tab', details.id)
      this.prepareTab(details, tab)

      const idx = this.tabs().findIndex((t) => t.id == tabId)
      if (idx > -1) this.tabs.splice(idx, 1, details)
      else console.error(`couldn't find tab with id ${tabId}`)

      if (this.activeTabId() > 0 && details.active() && this.activeTabId() != details.id) {
        //console.log('>> also updating old selected tab', this.activeTabId())
        const currentActive = this.tabs().find((t) => t.id === this.activeTabId())
        currentActive.active(false)
        //console.log('setting new active tab', details.id)
        this.activeTabId(details.id)
      }
      this.updateTabSeparators(this.tabs())
      if (details.url != tab.url) await this.updateTabShouldHideAddressBar(details)
    })
    chrome.tabs.onRemoved.addListener(async (tabId) => {
      if (!this.tabs().some((t) => t.id == tabId)) return
      await this.renderTabs()
    })
    chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
      if (!this.tabs().some((t) => t.id == tabId)) return
      await this.renderTabs()
    })

    chrome.downloads.onCreated.addListener((dl) => {
      if (!this.downloads().some((d) => d.state == 'in_progress')) {
        this.downloads([])
      }
      if (dl.totalBytes) {
        const existing = this.downloads().find((d) => d.id == dl.id)
        if (existing) this.downloads.replace(existing, dl)
        else this.downloads.push(dl)
      }
      this.updateDownloadStats()
    })
    chrome.downloads.onChanged.addListener(async (downloadId, delta) => {
      const results = await chrome.downloads.search({ id: downloadId })
      if (!results.length) {
        console.error(
          'received update for download but downloads api returned no results for its ID.',
          delta,
        )
        return
      }
      const dl = results[0]
      const existing = this.downloads().find((d) => d.id == downloadId)
      if (['in_progress', 'complete'].includes(dl.state)) {
        if (existing) this.downloads.replace(existing, dl)
        else this.downloads.push(dl)
      } else if (existing) this.downloads.remove(existing)
      this.updateDownloadStats()
    })
    chrome.downloads.onErased.addListener((downloadId) => {
      const existing = this.downloads().find((d) => d.id == downloadId)
      if (existing) this.downloads.remove(existing)
      this.updateDownloadStats()
    })
  }

  async sendTopbarSize() {
    const height = document.getElementById('topbar-container').clientHeight
    //console.log(">> sending new topbar height", height)
    await this.sendToMain('webui-display-mode-changed', { height })
  }

  async receiveFromMain(msg) {
    switch (msg.type) {
      case 'status-kc3-is-updating':
      case 'error-do-update':
      case 'update-process-started':
      case 'update-process-progress':
      case 'update-process-completed':
        // worker -> main -> webui -> settings
        chrome.runtime.sendMessage(msg)
        break
      case 'webui-init':
        this.init(msg.data.windowId)
        break
      case 'webui-display-mode':
        await this.sendTopbarSize()
        break
      case 'webui-toggle-addressbar':
        //console.log(msg)
        if (!this.activeTab() || this.activeTab().url == this.settingsUrl) return
        this.activeTab().showAddressBar(!this.activeTab().showAddressBar())
        break
      case 'webui-focus-addressbar':
        const activeTab = this.tabs().find((t) => t.active())
        if (!activeTab || activeTab.url === this.settingsUrl) return

        // TODO: MVVM-ify this somehow?
        document.getElementById('addressurl').select()
        break
      default:
        alert('webui.js received unknown webui-message type from main:\n' + JSON.stringify(msg))
        break
    }
  }

  async receiveFromRenderer(msg) {
    switch (msg.type) {
      case 'get-config':
      case 'get-config-item':
      case 'kc3-doupdate':
      case 'kc3-get-isupdating':
      case 'kc3-select-custom-location':
        return this.sendToMain(msg.type, msg.data)
      case 'set-config-item':
        const result = await this.sendToMain(msg.type, msg.data)
        if (msg.data.key == 'window.style.theme') this.theme(msg.data.value)
        if (msg.data.key == 'window.style.brightness') this.brightness(msg.data.value)
        return result
      default:
        throw new Error(
          `webui.js received unknown message type from renderer:\n${JSON.stringify(msg)}`,
        )
    }
  }

  async sendToMain(type, data) {
    return await ipc.send('webui-message', type, data)
  }

  tabMouseDown(tab, ev) {
    if (ev.button === 1 && tab.url != this.settingsUrl) this.closingTabId = tab.id
    else this.closingTabId = -1

    if (ev.button === 0) {
      this.heldTabId = tab.id
    }
  }
  async tabMouseMove(tab, ev) {
    if (this.hoveringTabId != tab.id) {
      this.hoveringTabId = tab.id
      this.updateTabSeparators(this.tabs())
    }
    if (this.heldTabId == -1) return
    const heldTab = this.tabs().find((t) => t.id === this.heldTabId)
    if (heldTab.url == this.settingsUrl || tab.url == this.settingsUrl || tab.id == this.heldTabId)
      return

    const thisIndex = this.tabs().findIndex((t) => t.id == tab.id)

    if (!heldTab.active()) await chrome.tabs.update(heldTab.id, { active: true })
    await chrome.tabs.move(this.heldTabId, { index: thisIndex })
    await this.renderTabs()
  }
  tabMouseOut(tab, ev) {
    this.hoveringTabId = -1
    this.updateTabSeparators(this.tabs())
  }
  tabMouseUp(tab, ev) {
    if (ev.button === 1 && this.closingTabId == tab.id) chrome.tabs.remove(tab.id)
    else if (ev.button === 0) {
      if (this.heldTabId == tab.id) {
        chrome.tabs.update(tab.id, { active: true })
        if (
          !this.downloads().some((d) => d.state == 'in_progress') &&
          [tab.url, this.activeTab().url].includes(this.settingsUrl)
        )
          this.downloads([])
      }
      this.heldTabId = -1
    }
    return true
  }

  browserActionNewTab() {
    chrome.tabs.create()
  }
  browserActionGoBack() {
    chrome.tabs.goBack()
  }
  browserActionGoForward() {
    chrome.tabs.goForward()
  }
  browserActionReload() {
    chrome.tabs.reload()
  }
  browserActionCloseTab(tab, ev) {
    chrome.tabs.remove(tab.id)
    return true
  }
  browserActionAddressKeyDown(data, event) {
    event = event.originalEvent
    if (!['Enter', 'NumpadEnter'].includes(event.code)) return true
    let url = this.activeTab().urlInput()
    if (url.toLowerCase() == this.settingsUrl.toLowerCase()) return
    if (event.ctrlKey) {
      const shouldComplete = /^\w[\w\d-]+$/.test(url)
      //console.log('trying to complete url', url, shouldComplete)
      if (shouldComplete) {
        //console.log('completing url.')
        url = `https://${url}.com/`
      }
    }
    chrome.tabs.update({ url })
    return false
  }
  browserActionAddressBlur(event) {
    // TODO: MVVM-ify this somehow?
    document.getElementById('addressurl').deselect()
  }

  async windowActionMinimize() {
    const win = await this.getCurrentWindow()
    const state = win.state === 'minimized' ? 'normal' : 'minimized'
    chrome.windows.update(win.id, { state })
    this.windowState(state)
  }
  async windowActionMaximize() {
    const win = await this.getCurrentWindow()
    // when restoring from minimized state, the state value isn't updated immediately
    const state = ['maximized', 'minimized'].includes(win.state) ? 'normal' : 'maximized'
    chrome.windows.update(win.id, { state })
    this.windowState(state)
  }
  windowActionClose() {
    chrome.windows.remove()
  }

  async getCurrentWindow() {
    return this.getWindow(chrome.windows.WINDOW_ID_CURRENT)
  }
  async getWindow(windowId) {
    return new Promise((resolve) => chrome.windows.get(windowId, resolve))
  }
  async getCurrentTabs() {
    return this.getTabs(chrome.windows.WINDOW_ID_CURRENT)
  }
  async getTabs(windowId) {
    return new Promise((resolve) => chrome.tabs.query(windowId, resolve))
  }
}
window.vm = new WebUI()
$(document).ready(() => ko.applyBindings(window.vm))

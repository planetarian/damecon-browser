class WebUITab {
  inputUrl = ko.observable()
}

class WebUI {
  windowId = ko.observable(-1)

  theme = ko.observable('andra')
  brightness = ko.observable('system')

  tabs = ko.observableArray([])
  activeTab = ko.observable({})
  activeTabId = ko.observable(-1)
  heldTabId = -1
  closingTabId = -1
  
  windowState = ko.observable()
  showToolbar = ko.observable()

  platform = navigator.userAgentData.platform.toLowerCase()
  settingsUrl = 'chrome-extension://' + chrome.runtime.id + '/settings.html'

  constructor() {
    ipc.on('webui-message', async (ev, msg) => {
      console.log('>> from main: ', msg)
      if (msg?.type) await this.receiveFromMain(msg)
      else alert('webui.js received invalid webui-message from main:\n' + JSON.stringify(msg))
    })
    chrome.runtime.onMessage.addListener(function(msg, sender, sendresponse) {
      ;(async () => {
        console.log('>> from renderer: ', msg)
        if (msg?.type) {
          try {
            const result = await this.receiveFromRenderer(msg)
            sendresponse({ result, complete: true })
          }
          catch (error) {
            alert (`webui.js encountered an error handling message from renderer\nError: ${error}\nMessage:${JSON.stringify(msg)}\n`)
            sendresponse({ error, complete: false })
          }
        }
        else alert ('webui.js received invalid message from renderer\n' + JSON.stringify(msg))
      })()
      return true
    }.bind(this))
  }

  async init(windowId) {
    if (this.windowId() >= 0) return
    this.windowId(windowId)

    console.log('>> init()', windowId)
    await this.initTheme()
    // wait for initial tab to load
    await sleep(100)
    await this.initTabs()
  }

  async initTheme() {
    const theme = await this.sendToMain('get-config-item', { key: 'window.style.theme' })
    this.theme(theme)
    const brightness = await this.sendToMain('get-config-item', { key: 'window.style.brightness' })
    this.brightness(brightness)
  }

  async initTabs() {
    console.log('>> initTabs()')
    this.renderTabs()

    // TODO
    //if (activeTab)
      //this.setActiveTab(activeTab)

    this.setupBrowserListeners()
  }

  async renderTabs() {
    console.log('>> rendering tabs')
    const tabs = [...await this.getTabs()]

    let foundActive = false
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i]
      foundActive = foundActive || tab.active
      if (tab.active)
        tab.position = 'active'
      else if (!foundActive && i > 0 && i < tabs.length-1)
        tab.position = 'before'
      else if (foundActive)
        tab.position = 'after'
      else
        tab.position = 'none'
    }

    this.tabs(tabs)

    const activeTab = tabs.find(tab => tab.active)
    if (this.activeTabId() == -1 && tabs.length > 0)
      this.activeTabId(activeTab?.id || tabs[0].id)
  }

  async setupBrowserListeners() {
    chrome.tabs.onCreated.addListener(tab => {
      if (tab.windowId !== this.windowId()) return
      this.renderTabs()
    })
    chrome.tabs.onUpdated.addListener(tabId => {
      if (!this.tabs().some(t => t.id == tabId)) return
      this.renderTabs()
    })
    chrome.tabs.onRemoved.addListener(tabId => {
      if (!this.tabs().some(t => t.id == tabId)) return
      this.renderTabs()
    })
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
        const win = await this.getWindow()
        // needed?
        break
      case 'webui-render-toolbar':
        // TODO
        //this.tryShowToolbar(msg.data.forceShow)
        break
      case 'webui-focus-addressbar':
        const activeTab = this.tabs().find(t => t.active)
        if (!activeTab || activeTab.url === this.settingsUrl) return

        // TODO
        //this.tryShowToolbar(true)
        //if (this.showToolbar())
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
        if (msg.data.key == 'window.style.theme')
          this.theme(msg.data.value)
        if (msg.data.key == 'window.style.brightness')
          this.brightness(msg.data.value)
        return result
      default:
        throw new Error(`webui.js received unknown message type from renderer:\n${JSON.stringify(msg)}`)
    }
  }

  async sendToMain(type, data) {
    return await ipc.send('webui-message', type, data)
  }

  browserEventTabMouseDown(tab, ev) {
    if (ev.button === 1 && tab.url != this.settingsUrl) this.closingTabId = tab.id
    else this.closingTabId = -1

    if (ev.button === 0) {
      this.heldTabId = tab.id
    }
  }
  browserEventTabMouseMove(tab, ev) {
    if (this.heldTabId == -1 || tab.url == this.settingsUrl) return
  }
  browserEventTabMouseUp(tab, ev) {
    if (ev.button === 1 && this.closingTabId == tab.id)
      chrome.tabs.remove(tab.id)
    else if (ev.button === 0 && this.heldTabId == tab.id) {
      chrome.tabs.update(tab.id, { active: true })
      this.heldTabId = -1
    }
    return true
  }

  browserActionNewTab() { chrome.tabs.create() }
  browserActionGoBack() { chrome.tabs.goBack() }
  browserActionGoForward() { chrome.tabs.goForward() }
  browserActionReload() { chrome.tabs.reload() }
  browserActionCloseTab(tab, ev) {
    chrome.tabs.remove(tab.id)
    return true
  }
  browserActionAddressKeyDown(event) {
    if (!['Enter', 'NumpadEnter'].includes(event.code)) return
    // TODO: etc
  }
  browserActionAddressBlur(event) {
    // TODO: MVVM-ify this somehow?
    document.getElementById('addressurl').deselect()
  }

  async windowActionMinimize() {
    const win = await this.getWindow()
    const state = win.state === 'minimized' ? 'normal' : 'minimized'
    chrome.windows.update(win.id, { state })
    this.windowState(state)
  }
  async windowActionMaximize() {
    const win = await this.getWindow()
    // when restoring from minimized state, the state value isn't updated immediately
    const state = ['maximized', 'minimized'].includes(win.state) ? 'normal' : 'maximized'
    chrome.windows.update(win.id, { state })
    this.windowState(state)
  }
  windowActionClose() {
    chrome.windows.remove()
  }

  
  async getWindow() { return this.getWindow(chrome.windows.WINDOW_ID_CURRENT) }
  async getWindow(windowId) {
    return new Promise(resolve => chrome.windows.get(windowId, resolve))
  }
  async getTabs() { return this.getTabs(chrome.windows.WINDOW_ID_CURRENT) }
  async getTabs(windowId) {
    return new Promise(resolve => chrome.tabs.query(windowId, resolve))
  }
}
window.vm = new WebUI()
$(document).ready(() => ko.applyBindings(window.vm))

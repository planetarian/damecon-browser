class WebUITab {
  inputUrl = ko.observable()
}

class WebUI {
  windowId = ko.observable(-1)

  tabs = ko.observableArray([])
  activeTab = ko.observable({})
  windowState = ko.observable()
  showToolbar = ko.observable()

  constructor() {
    ipc.on('webui-message', async (ev, msg) => {
      console.log('>> webui-message: ', msg)
      if (msg?.type) await this.receiveFromMain(msg)
      else alert('webui.js received invalid webui-message:\n' + JSON.stringify(msg))
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
        self.init(msg.data.windowId)
        break
      case 'webui-display-mode':
        const win = await this.getWindow()
        // needed?
        break
      case 'webui-render-toolbar':
        self.tryShowToolbar(msg.data.forceShow)
        break
      case 'webui-focus-addressbar':
        self.tryShowToolbar(true)
        if (self.showToolbar()) document.getElementById('addressurl').select()
        break
      default:
        alert('webui.js received unknown webui-message type:\n' + JSON.stringify(msg))
        break
    }
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
  browserActionAddressKeyDown(event) {
    if (!['Enter', 'NumpadEnter'].includes(event.code)) return
    // TODO: etc
  }
  browserActionAddressBlur(event) {
    document.getElementById('addressurl').deselect()
  }

  async getWindow() {
    return new Promise((resolve) => chrome.windows.get(chrome.windows.WINDOW_ID_CURRENT, resolve))
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
}
window.vm = new WebUI()
$(document).ready(() => ko.applyBindings(window.vm))

class WebUI {
  windowId = -1
  activeTabId = -1
  tabList = []
  initialized = false

  heldTabId = -1
  settingsUrl = 'chrome-extension://' + chrome.runtime.id + '/settings.html'

  constructor() {
    const self = this
    const $ = document.querySelector.bind(document)

    this.$ = {
      tabList: $('#tabstrip .tab-list'),
      tabTemplate: $('#tabtemplate'),
      createTabButton: $('#createtab'),
      goBackButton: $('#goback'),
      goForwardButton: $('#goforward'),
      reloadButton: $('#reload'),
      addressUrl: $('#addressurl'),

      browserActions: $('#actions'),

      minimizeButton: $('#minimize'),
      maximizeButton: $('#maximize'),
      closeButton: $('#close'),

      body: $('body'),
      root: $('#root'),
      topBar: $('#topbar'),
      toolBar: $('.toolbar'),
      zoomPresenter: $('#zoom-presenter'),
    }

    this.$.createTabButton.addEventListener('click', () => chrome.tabs.create())
    this.$.goBackButton.addEventListener('click', () => chrome.tabs.goBack())
    this.$.goForwardButton.addEventListener('click', () => chrome.tabs.goForward())
    this.$.reloadButton.addEventListener('click', () => chrome.tabs.reload())
    this.$.addressUrl.addEventListener('keypress', this.onAddressUrlKeyPress.bind(this))

    this.$.minimizeButton.addEventListener('click', () =>
      chrome.windows.get(chrome.windows.WINDOW_ID_CURRENT, (win) => {
        chrome.windows.update(win.id, { state: win.state === 'minimized' ? 'normal' : 'minimized' })
      }),
    )
    this.$.maximizeButton.addEventListener('click', () =>
      chrome.windows.get(chrome.windows.WINDOW_ID_CURRENT, (win) => {
        chrome.windows.update(win.id, { state: win.state === 'maximized' ? 'normal' : 'maximized' })
      }),
    )
    this.$.closeButton.addEventListener('click', () => chrome.windows.remove())

    const platformClass = `platform-${navigator.userAgentData.platform.toLowerCase()}`
    document.body.classList.add(platformClass)

    // Received message from main.js
    ipc.on('webui-message', (ev, msg) => {
      console.log('>> webui-message: ', msg)
      if (msg?.type) {
        switch (msg.type) {
          case 'status-kc3-is-updating':
          case 'error-do-update':
          case 'update-process-started':
          case 'update-process-progress':
          case 'update-process-completed':
            chrome.runtime.sendMessage(msg)
            break
          case 'webui-init':
            self.init(msg.data.windowId)
            break
          default:
            alert('webui.js received unknown webui-message type:\n' + JSON.stringify(msg))
            break
        }
      } else alert('webui.js received unknown webui-message:\n' + JSON.stringify(msg))
    })

    // Received message from settings.js/new-tab.js
    chrome.runtime.onMessage.addListener(
      function (msg, sender, sendResponse) {
        ;(async () => {
          console.log('>> chrome.runtime.onMessage', msg)
          let result
          try {
            switch (msg.type) {
              case 'get-config':
                result = await ipc.send('webui-message', 'get-config')
                break
              case 'get-config-item':
                result = await ipc.send('webui-message', 'get-config-item', { key: msg.data.key })
                break
              case 'set-config-item':
                result = await ipc.send('webui-message', 'set-config-item', {
                  key: msg.data.key,
                  value: msg.data.value,
                })
                if (msg.data.key == 'window.style.theme') {
                  this.$.body.dataset.colorTheme = msg.data.value
                } else if (msg.data.key == 'window.style.brightness') {
                  this.$.body.dataset.brightness = msg.data.value
                }
                break
              case 'kc3-doupdate':
              case 'kc3-get-isupdating':
              case 'kc3-select-custom-location':
                result = await ipc.send('webui-message', msg.type)
                break
              default:
                throw new Error(`Unknown message type ${msg.type || '(none)'}`)
            }
            sendResponse({ result, complete: true })
          } catch (error) {
            console.log('webui.js encountered an error retrieving a response to a message', error)
            sendResponse({ error, complete: false })
          }
        })()
        return true
      }.bind(this),
    )

    let headerHeight = 0
    let zoomResetTimestamp = 0
    let prevZoomFactor = 0
    // detect when the UI has been resized
    const resizeObserver = new ResizeObserver(async (entries) => {
      for (const entry of entries) {
        const height = entry.devicePixelContentBoxSize[0].blockSize
        const factor = window.devicePixelRatio

        if (headerHeight > 0 && prevZoomFactor != factor)
          this.$.zoomPresenter.style.display = 'block'
        this.$.zoomPresenter.textContent = `${(factor * 100).toFixed(0)}%`
        const fInv = 1 / factor
        this.$.zoomPresenter.style.fontSize = `${12 * fInv}px`
        this.$.zoomPresenter.style.padding = `${1 * fInv}px ${4 * fInv}px ${2 * fInv}px ${4 * fInv}px`
        this.$.zoomPresenter.style.margin = `${2 * fInv}px`
        this.$.zoomPresenter.style.borderWidth = `${1 * fInv}px`

        prevZoomFactor = factor
        zoomResetTimestamp = new Date(Date.now() + 950)
        setTimeout(() => {
          if (Date.now() > zoomResetTimestamp) this.$.zoomPresenter.style.display = 'none'
        }, 1000)
        if (height != headerHeight) {
          headerHeight = height
          await ipc.send('webui-message', 'webui-zoom-changed', { height, factor })
        }
      }
    })
    resizeObserver.observe(this.$.topBar)
  }

  async init(windowId) {
    if (this.initialized) return
    this.initialized = true
    this.windowId = windowId

    console.log('>> init()', windowId)
    await this.initTheme()
    // wait for initial tab to load
    await sleep(100)
    await this.initTabs()
  }

  async initTheme() {
    const theme = await ipc.send('webui-message', 'get-config-item', { key: 'window.style.theme' })
    this.$.body.dataset.colorTheme = theme
    const bright = await ipc.send('webui-message', 'get-config-item', {
      key: 'window.style.brightness',
    })
    this.$.body.dataset.brightness = bright
  }

  async initTabs() {
    console.log('>> initTabs()')
    const tabs = await new Promise((resolve) => chrome.tabs.query({ windowId: -2 }, resolve))
    this.tabList = [...tabs]

    const activeTab = this.tabList.find((tab) => tab.active)
    if (this.activeTabId == -1 && this.tabList.length > 0) this.activeTabId = activeTab?.id

    this.renderTabs()

    console.log('>> activeTab:', activeTab)
    if (activeTab) {
      this.setActiveTab(activeTab)
    }

    // Wait to setup tabs and windowId prior to listening for updates.
    this.setupBrowserListeners()
  }

  setupBrowserListeners() {
    if (!chrome.tabs.onCreated) {
      throw new Error(`chrome global not setup. Did the extension preload not get run?`)
    }

    const findTab = (tabId) => {
      const existingTab = this.tabList.find((tab) => tab.id === tabId)
      return existingTab
    }

    const findOrCreateTab = (tabId) => {
      const existingTab = findTab(tabId)
      if (existingTab) return existingTab

      const newTab = { id: tabId }
      this.tabList.push(newTab)
      return newTab
    }

    chrome.tabs.onCreated.addListener((tab) => {
      console.log('>> chrome.tabs.onCreated', tab)
      if (tab.windowId !== this.windowId) return
      const newTab = findOrCreateTab(tab.id)
      Object.assign(newTab, tab)
      this.renderTabs()
    })

    chrome.tabs.onActivated.addListener((activeInfo) => {
      console.log('>> chrome.tabs.onActivated', activeInfo)
      if (activeInfo.windowId !== this.windowId) return

      this.setActiveTab(activeInfo)
    })

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, details) => {
      console.log('>> chrome.tabs.onUpdated', tabId, details)
      const tab = findTab(tabId)
      if (!tab) return
      Object.assign(tab, details)
      if (tab.active) {
        this.setActiveTab(tab)
      } else this.renderTabs()
    })

    chrome.tabs.onRemoved.addListener((tabId) => {
      console.log('>> chrome.tabs.onRemoved', tabId)
      const tabIndex = this.tabList.findIndex((tab) => tab.id === tabId)
      if (tabIndex > -1) {
        this.tabList.splice(tabIndex, 1)
        this.$.tabList.querySelector(`[data-tab-id="${tabId}"]`).remove()
      }
    })
  }

  setActiveTab(activeTab) {
    console.log('>> setting active tab', activeTab)
    this.activeTabId = activeTab?.id || activeTab?.tabId
    this.windowId = activeTab?.windowId || this.windowId

    this.renderTabs()
  }

  onAddressUrlKeyPress(event) {
    if (event.code === 'Enter') {
      const url = this.$.addressUrl.value
      chrome.tabs.update({ url })
    }
  }

  createTabNode(tab) {
    console.log('>> creating tab node', tab)
    const tabElem = this.$.tabTemplate.content.cloneNode(true).firstElementChild
    tabElem.dataset.tabId = tab.id

    tabElem.addEventListener('click', () => {
      chrome.tabs.update(tab.id, { active: true })
    })
    tabElem.querySelector('.close').addEventListener('click', () => {
      ipc.send('webui-message', 'webui-close-tab', { tabId: tab.id })
      //chrome.tabs.remove(tab.id)
    })
    const faviconElem = tabElem.querySelector('.favicon')
    faviconElem?.addEventListener('load', () => {
      faviconElem.classList.toggle('loaded', true)
    })
    faviconElem?.addEventListener('error', () => {
      faviconElem.classList.toggle('loaded', false)
    })

    tabElem.addEventListener('mousedown', async (event) => {
      if (event.button === 0) {
        chrome.tabs.update(tab.id, { active: true })

        //Sometime can be revisited to add an elegant solution for sticky tabs,
        //for now adding this condition to not drag the first tab which is the settings menu
        this.heldTabId = tab.url == this.settingsUrl ? -1 : tab.id
      }

      if (event.button === 1) {
        ipc.send('webui-message', 'webui-close-tab', { tabId: tab.id })
      }
    })

    window.addEventListener('mousemove', (event) => {
      if (this.heldTabId != -1) {
        var tab = this.$.tabList.querySelector(`[data-tab-id="${this.heldTabId}"]`)
        var startingPos = tab.offsetLeft
        var width = tab.offsetWidth
        //Drag and drop offsets, this feels "nice" but could be done better I think
        var toMoveRight = startingPos + width * 1.15
        var toMoveLeft = startingPos - width * 0.15
        if (event.clientX > toMoveRight && tab.nextSibling !== null) {
          if (tab.nextSibling.nextSibling === null)
            //Sending to last place
            this.$.tabList.appendChild(tab)
          else this.$.tabList.insertBefore(tab, tab.nextSibling.nextSibling)
        }
        if (event.clientX < toMoveLeft && tab.previousSibling !== null) {
          if (tab.previousSibling.offsetLeft != -2)
            //Same deal here for sticky tabs
            this.$.tabList.insertBefore(tab, tab.previousSibling)
        }
      }
    })

    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.heldTabId = -1
    })

    this.$.tabList.appendChild(tabElem)
    return tabElem
  }

  renderTabs() {
    console.log('>> rendering tabs')
    let activeFound = this.activeTabId == -1
    let activeTab

    console.log('activeTabId', this.activeTabId)
    console.log('activeFound', activeFound)

    for (let i = 0; i < this.tabList.length; i++) {
      const tab = this.tabList[i]
      const isActiveTab = tab.id === this.activeTabId
      console.log('tab', tab)
      console.log('isActiveTab', isActiveTab)
      if (this.activeTabId && isActiveTab) {
        console.log('activating tab')
        tab.active = true
        activeTab = tab
      } else {
        console.log('deactivating tab')
        tab.active = false
      }
      activeFound = tab.active || activeFound
      console.log('activeFound', activeFound)
      if (!tab.active && i > 0) tab.tabPosition = activeFound ? 'after' : 'before'
      this.renderTab(tab)
    }
    this.renderToolbar(activeTab)
  }

  renderTab(tab) {
    console.log('rendering tab', tab)
    let tabElem = this.$.tabList.querySelector(`[data-tab-id="${tab.id}"]`)
    if (!tabElem) tabElem = this.createTabNode(tab)

    if (tab.active) {
      tabElem.dataset.active = ''
      delete tabElem.dataset.tabPosition
    } else {
      delete tabElem.dataset.active
      tabElem.dataset.tabPosition = tab.tabPosition
    }

    if (tab.url == this.settingsUrl) {
      tabElem.dataset.compact = ''
    } else {
      delete tabElem.dataset.compact
    }

    const favicon = tabElem.querySelector('.favicon')
    if (tab.favIconUrl) {
      favicon.src = tab.favIconUrl
    } else {
      delete favicon.src
    }

    tabElem.querySelector('.title').textContent = tab.title
    tabElem.querySelector('.audio').disabled = !tab.audible
  }

  renderToolbar(tab) {
    console.log('rendering toolbar for tab', tab)
    this.$.addressUrl.value = tab?.url
    // this.$.browserActions.tab = tab.id
    if (tab?.url == this.settingsUrl) this.$.toolBar.dataset.hidden = ''
    else delete this.$.toolBar.dataset.hidden
  }
}

window.webui = new WebUI()

import { EventEmitter } from 'events'
import Tab from './tab.js'

class Tabs extends EventEmitter {
  tabList = []
  selected = null

  // damecon customizations
  newTabPageUrl = null
  hidden = false

  constructor(browserWindow, options) {
    super()
    this.window = browserWindow
    // damecon customizations
    this.newTabPageUrl = options.newTabPageUrl ?? 'about:blank'
    this.hidden = options?.hidden ?? false
  }

  destroy() {
    this.tabList.forEach((tab) => tab.destroy())
    this.tabList = []

    this.selected = undefined

    if (this.window) {
      this.window.destroy()
      this.window = undefined
    }
  }

  get(tabId) {
    return this.tabList.find((tab) => tab.id === tabId)
  }

  create(webContentsViewOptions) {
    //console.log('>> tabs.create()', webContentsViewOptions?.initialUrl)
    const tab = new Tab(this.window, webContentsViewOptions)
    this.tabList.push(tab)
    if (!this.selected) this.selected = tab

    //tab.show() // must be attached to window
    const url = webContentsViewOptions?.initialUrl ?? this.newTabPageUrl
    //console.log('>> creating tab', url, webContentsViewOptions)
    tab.webContents.on('did-navigate', (origin, targets) => {
      this.emit('tab-navigated', tab, url)
    })
    tab.webContents.loadURL(url)

    this.emit('tab-created', tab)
    //this.select(tab.id)
    return tab
  }

  remove(tabId) {
    //console.log('>> tabs.remove()', tabId)
    const tabIndex = this.tabList.findIndex((tab) => tab.id === tabId)
    if (tabIndex < 0) {
      throw new Error(`Tabs.remove: unable to find tab.id = ${tabId}`)
    }
    const tab = this.tabList[tabIndex]
    this.tabList.splice(tabIndex, 1)
    tab.destroy()
    if (this.selected === tab) {
      this.selected = undefined
      const nextTab = this.tabList[tabIndex] || this.tabList[tabIndex - 1]
      if (nextTab) this.select(nextTab.id)
    }
    this.emit('tab-destroyed', tab)
    if (this.tabList.length === 0) {
      this.destroy()
    }
  }

  removeExtensionTabs(extensionId) {
    //console.log('>> tabs: removing tabs for extension', extensionId)
    //console.log('>> - all ids', this.tabList.map((tab) => tab.id))
    const tabs = this.tabList.filter((tab) =>
      tab.webContents.getURL().startsWith(`chrome-extension://${extensionId}/`),
    )
    tabs.forEach((tab) => tab.destroy())
  }

  select(tabId) {
    const tab = this.get(tabId)
    if (!tab) return
    if (!this.hidden) tab.show()
    if (this.selected) {
      if (this.selected != tab) this.selected.hide()
      else return // already selected
    }
    this.selected = tab
    //console.log('>> tabs.select()', tabId)
    this.emit('tab-selected', tab)
  }

  deselect() {
    //console.log('>> tabs.deselect()')
    const tab = this.selected
    if (tab) {
      this.emit('tab-deselected', tab)
      tab.hide()
    }
    this.selected = null
  }

  hide() {
    //console.log('>> tabs.hide()')
    if (this.selected) this.deselect()
    this.hidden = true
  }

  show() {
    //console.log('>> tabs.show()')
    this.hidden = false
    if (this.selected) this.selected.show()
  }

  updateLayout(headerHeight) {
    this.tabList.forEach((tab) => {
      tab.updateLayout(headerHeight)
    })
  }
}

export default Tabs

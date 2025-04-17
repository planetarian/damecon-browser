const { BrowserView } = require('electron')

let topBarHeight = 64

class Tab {
  constructor(parentWindow, webContentsViewOptions = {}) {
    // needed because browserwindow events don't bind this correctly
    this.updateLayout = this.updateLayout.bind(this)

    this.view = new BrowserView()
    this.id = this.view.webContents.id
    this.window = parentWindow
    this.webContents = this.view.webContents
    this.window.addBrowserView(this.view)
    this.visible = false
  }

  destroy() {
    if (this.destroyed) return

    this.destroyed = true

    this.hide()

    this.window.removeBrowserView(this.view)
    this.window = undefined

    if (!this.webContents.isDestroyed()) {
      if (this.webContents.isDevToolsOpened()) {
        this.webContents.closeDevTools()
      }

      // TODO: why is this no longer called?
      this.webContents.emit('destroyed')

      this.webContents.destroy()
    }

    this.webContents = undefined
    this.view = undefined
  }

  loadURL(url) {
    console.log('>> tab.loadURL()', url)
    return this.view.webContents.loadURL(url)
  }

  show() {
    console.log('>> tab.show()', this.id)
    this.visible = true
    this.updateLayout()
  }

  hide() {
    console.log('>> tab.hide()', this.id)
    //this.stopResizeListener()
    this.visible = false
    this.updateLayout()
  }

  reload() {
    console.log('>> tab.reload()')
    this.view.webContents.reload()
  }

  updateLayout(headerHeight = 0) {
    const { width, height } = this.window.getContentBounds()
    const padding = 0
    if (headerHeight > 0) topBarHeight = headerHeight
    const yOffset = topBarHeight // this.hideToolbar ? tabBarHeight : toolbarHeight;

    if (this.visible) {
      this.view.setBackgroundColor('white')
      this.view.setBounds({
        x: padding,
        y: yOffset,
        width: width - padding * 2,
        height: height - yOffset - padding,
      })
      this.view.setAutoResize({ width: true, height: true })
    } else {
      this.view.setAutoResize({ width: false, height: false })
      this.view.setBounds({ x: -1000, y: 0, width: 0, height: 0 })
    }
    //this.view.setBorderRadius(8)
  }

  // Replacement for BrowserView.setAutoResize. This could probably be better...
  startResizeListener() {
    this.stopResizeListener()
    //this.window.on('resize', this.updateLayout)
  }
  stopResizeListener() {
    //this.window.off('resize', this.updateLayout)
  }
}

export default Tab

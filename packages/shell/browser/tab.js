const { WebContentsView } = require('electron')

const toolbarHeight = 64
const tabBarHeight = 32
let topBarHeight = 64

class Tab {
  constructor(parentWindow, webContentsViewOptions = {}) {
    // needed because browserwindow events don't bind this correctly
    this.updateLayout = this.updateLayout.bind(this)

    this.view = new WebContentsView(webContentsViewOptions)
    this.id = this.view.webContents.id
    this.window = parentWindow
    this.webContents = this.view.webContents
    this.window.contentView.addChildView(this.view)
  }

  destroy() {
    if (this.destroyed) return

    this.destroyed = true

    this.hide()

    this.window.contentView.removeChildView(this.view)
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
    console.log('>> tab.show()')
    this.updateLayout()
    this.startResizeListener()
    this.view.setVisible(true)
  }

  hide() {
    console.log('>> tab.hide()')
    this.stopResizeListener()
    this.view.setVisible(false)
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
    this.view.setBackgroundColor('white')
    this.view.setBounds({
      x: padding,
      y: yOffset,
      width: width - padding * 2,
      height: height - yOffset - padding,
    })
    //this.view.setBorderRadius(8)
  }

  // Replacement for BrowserView.setAutoResize. This could probably be better...
  startResizeListener() {
    this.stopResizeListener()
    this.window.on('resize', this.updateLayout)
  }
  stopResizeListener() {
    this.window.off('resize', this.updateLayout)
  }
}

exports.Tab = Tab

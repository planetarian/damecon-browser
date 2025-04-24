import path from 'path'
import fsSync from 'fs'
import url from 'url'
import {
  app,
  session,
  BrowserWindow,
  Notification,
  globalShortcut,
  ipcMain,
  nativeTheme,
  dialog,
} from 'electron'
import ConfigStore from 'configstore'

// These two break if using import syntax...?
const { ElectronChromeExtensions } = require('electron-chrome-extensions')
const { installChromeWebStore, loadAllExtensions } = require('electron-chrome-web-store')

import { buildChromeContextMenu } from 'electron-chrome-context-menu'
import setupMenu from './menu'
import Tabs from './tabs'

import './workers/worker-shim'
import kc3UpdateWorker from 'worker-loader!./workers/kc3update-worker.js'

import { setTimeout } from 'timers/promises'
import { debug } from 'console'

const defaultConfig = {
  window: {
    state: {
      width: 1200,
      height: 800,
    },
    style: {
      theme: 'andra',
      brightness: 'system',
    },
  },
  kc3kai: {
    update: {
      channel: 'release',
      schedule: 'daily',
      auto: true,
    },
    startup: {
      openStartPage: true,
      openDMMPage: false,
      openDevtools: true,
      openStratRoom: true,
    },
  },
  proxy: {
    client: {
      host: '127.0.0.1',
      port: 8081,
      enable: false,
    },
  },
}
const config = new ConfigStore('damecon-browser', defaultConfig, { globalConfigPath: true })

app.commandLine.appendSwitch('force-gpu-mem-available-mb', '10000')
app.commandLine.appendSwitch('force-gpu-rasterization')
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers')
app.commandLine.appendSwitch('enable-gpu-memory-buffer-compositor-resources')
app.commandLine.appendSwitch('enable-experimental-web-platform-features')

if (process.execPath.match(/(damecon(-browser)?|chrome)/)) {
  const currentPath = path.dirname(process.execPath)
  console.log('process.execPath', process.execPath)
  console.log('currentPath', currentPath)
  let p = path.join(currentPath, 'userdata')
  app.setPath('userData', p)
} else {
  // app.commandLine.appendSwitch('proxy-server', '192.168.0.123:1235')
}

// https://www.electronforge.io/config/plugins/webpack#main-process-code
const SHELL_ROOT_DIR = path.join(__dirname, '../../')
const ROOT_DIR = path.join(__dirname, '../../../../')
const PATHS = {
  WEBUI: app.isPackaged
    ? path.resolve(process.resourcesPath, 'ui')
    : path.resolve(SHELL_ROOT_DIR, 'browser', 'ui'),
  WORKERS: app.isPackaged
    ? path.resolve(process.resourcesPath, 'workers')
    : path.resolve(SHELL_ROOT_DIR, 'browser', 'workers'),
  PRELOAD: path.join(__dirname, '../renderer/browser/preload.js'),
  LOCAL_EXTENSIONS: path.join(ROOT_DIR, 'extensions'),
  KC3_EXTENSIONS: path.join(ROOT_DIR, 'extensions'),
  //KC3_EXTENSIONS: path.join(ROOT_DIR, 'ext_kc3kai'),
}

//*
console.log(`Is packaged: ${app.isPackaged}`)
console.log(`SHELL_ROOT_DIR: ${SHELL_ROOT_DIR}`)
console.log(`ROOT_DIR: ${ROOT_DIR}`)
console.log(`PATHS:`, PATHS)
//*/

let webuiExtensionId
let webuiUrl

let kc3ExtensionId
let kc3StartPageUrl
let DMMPageUrl
let newTabUrl
let settingsUrl
const manifestExists = async (dirPath) => {
  if (!dirPath) return false
  const manifestPath = path.join(dirPath, 'manifest.json')
  try {
    return (await fs.stat(manifestPath)).isFile()
  } catch {
    return false
  }
}

async function loadExtensions(session, extensionsPath) {
  const subDirectories = await fs.readdir(extensionsPath, {
    withFileTypes: true,
  })

  const extensionDirectories = await Promise.all(
    subDirectories
      .filter((dirEnt) => dirEnt.isDirectory())
      .map(async (dirEnt) => {
        if (dirEnt.name.startsWith('kc3kai-')) return false

        const extPath = path.join(extensionsPath, dirEnt.name)

        if (await manifestExists(extPath)) {
          return extPath
        }

        const extSubDirs = await fs.readdir(extPath, {
          withFileTypes: true,
        })

        const versionDirPath =
          extSubDirs.length === 1 && extSubDirs[0].isDirectory()
            ? path.join(extPath, extSubDirs[0].name)
            : null

        if (await manifestExists(versionDirPath)) {
          return versionDirPath
        }
      }),
  )

  const results = []

  for (const extPath of extensionDirectories.filter(Boolean)) {
    //console.log(`Loading extension from ${extPath}`)
    try {
      const extensionInfo = await session.loadExtension(extPath)
      results.push(extensionInfo)
    } catch (e) {
      console.error(e)
    }
  }

  return results
}

const getParentWindowOfTab = (tab) => {
  switch (tab.getType()) {
    case 'window':
      return BrowserWindow.fromWebContents(tab)
    case 'browserView':
    case 'webview':
      return tab.getOwnerBrowserWindow()
    case 'backgroundPage':
      return BrowserWindow.getFocusedWindow()
    default:
      throw new Error(`Unable to find parent window of '${tab.getType()}'`)
  }
}

class TabbedBrowserWindow {
  constructor(options) {
    const self = this

    this.session = options.session || session.defaultSession
    this.extensions = options.extensions

    // Can't inheret BrowserWindow
    // https://github.com/electron/electron/issues/23#issuecomment-19613241
    this.window = new BrowserWindow(options.window)
    this.id = this.window.id
    this.webContents = this.window.webContents

    // load window chrome
    if (process.env.SHELL_DEBUG) {
      this.webContents.openDevTools({ mode: 'detach' })
    }
    this.webContents.on('did-finish-load', () => {
      console.log('>> main: webui finished loading.')
      this.webContents.send('webui-message', {
        type: 'webui-init',
        data: { windowId: this.window.id },
      })
    })
    self.initTabs(options)
    this.webContents.loadURL(webuiUrl)

    queueMicrotask(async () => {
      await this.applyProxy()

      const settingsTab = this.tabs.create({ initialUrl: settingsUrl })
      this.tabs.select(settingsTab.id)

      /*if (options.initialUrl) {
        // Create initial tab
        const tab = this.tabs.create(options)
        //tab.loadURL(options.initialUrl)
      }*/
    })
  }

  initTabs(options) {
    const self = this
    const tabsOpts = { newTabPageUrl: newTabUrl, hideAddressBarFor: options.hideAddressBarFor }
    console.log('>> main: loading tabs', tabsOpts)
    this.tabs = new Tabs(this.window, tabsOpts)

    this.tabs.on('tab-created', function onTabCreated(tab) {
      console.log(">> main.tabs.on('tab-created', tabsOpts)")
      //tab.loadURL(options.urls.newtab)

      // Track tab that may have been created outside of the extensions API.
      self.extensions.addTab(tab.webContents, tab.window)
    })

    this.tabs.on('tab-navigated', function onTabNavigated(tab, tabUrl) {
      console.log(">> main.tabs.on('tab-navigated', tabsOpts)")
      if (
        (tabUrl === kc3StartPageUrl || tabUrl === DMMPageUrl) &&
        config.get('kc3kai.startup.openDevtools')
      ) {
        tab.webContents.openDevTools({ activate: true })
      }
    })

    this.tabs.on('tab-selected', function onTabSelected(tab) {
      console.log(">> main.tabs.on('tab-selected', tabsOpts)")
      self.extensions.selectTab(tab.webContents)
    })

    this.tabs.on('tabs-hidden', function onTabsHidden(hidden) {
      console.log(">> main.tabs.on('tabs-hidden', tabsOpts)")
      self.webContents.send('webui-message', { message: 'tabs-hidden', value: hidden })
    })
  }

  destroy() {
    this.tabs.destroy()
    this.window.destroy()
  }

  getFocusedTab() {
    return this.tabs.selected
  }

  generatePac(host, port) {
    const ips = [
      '*.kancolle-server.com',
      '203.104.209.71',
      '203.104.209.87',
      '125.6.184.215',
      '203.104.209.183',
      '203.104.209.150',
      '203.104.209.134',
      '203.104.209.167',
      '203.104.209.199',
      '125.6.189.7',
      '125.6.189.39',
      '125.6.189.71',
      '125.6.189.103',
      '125.6.189.135',
      '125.6.189.167',
      '125.6.189.215',
      '125.6.189.247',
      '203.104.209.23',
      '203.104.209.39',
      '203.104.209.55',
      '203.104.209.102',
    ]
    const gadget = 'w00g.kancolle-server.com'
    //const gadget = '203.104.209.7';

    const ipsExp = ips.join('|')
    const pac =
      'function FindProxyForURL(url, host) {\n' +
      `  if (shExpMatch(url, "http://(${ipsExp})/(kcs|kcs2)/*") || host == "${gadget}")\n` +
      `    return "PROXY ${host}:${port}";\n` +
      '  return "DIRECT";\n' +
      '}\n'

    return pac
  }

  async applyProxy() {
    const enable = config.get('proxy.client.enable')
    if (enable) {
      const host = config.get('proxy.client.host')
      const port = config.get('proxy.client.port')
      const data = this.generatePac(host, port)
      const pacData =
        'data:application/x-ns-proxy-autoconfig;base64,' +
        Buffer.from(data, 'utf8').toString('base64')
      const proxyConfig = { mode: 'pac_script', pacScript: pacData }
      await this.window.webContents.session.setProxy(proxyConfig)
    } else {
      await this.window.webContents.session.setProxy({ mode: 'system' })
    }
  }
}

class Browser {
  windows = []
  currentKc3ExtensionId = null

  urls = {
    newtab: 'about:blank',
  }

  constructor() {
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve
    })

    app.whenReady().then(this.init.bind(this))

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        this.destroy()
      }
    })

    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) this.createInitialWindow()
    })

    app.on('web-contents-created', this.onWebContentsCreated.bind(this))
  }

  destroy() {
    app.quit()
  }

  getFocusedWindow() {
    return this.windows.find((w) => w.window.isFocused()) || this.windows[0]
  }

  getWindowFromBrowserWindow(window) {
    return !window.isDestroyed() ? this.windows.find((win) => win.id === window.id) : null
  }

  getWindowFromWebContents(webContents) {
    let window

    if (this.popup && webContents === this.popup.browserWindow?.webContents) {
      window = this.popup.parent
    } else {
      window = getParentWindowOfTab(webContents)
    }

    return window ? this.getWindowFromBrowserWindow(window) : null
  }

  async init() {
    this.initSession()
    setupMenu(this)

    if ('registerPreloadScript' in this.session) {
      this.session.registerPreloadScript({
        id: 'shell-preload',
        type: 'frame',
        filePath: PATHS.PRELOAD,
      })
    } else {
      // TODO(mv3): remove
      this.session.setPreloads([PATHS.PRELOAD])
    }

    this.extensions = new ElectronChromeExtensions({
      license: 'internal-license-do-not-use',
      session: this.session,

      createTab: async (details) => {
        console.log('>> main.extensions.createTab()')
        await this.ready

        const win =
          typeof details.windowId === 'number' &&
          this.windows.find((w) => w.id === details.windowId)

        if (!win) {
          throw new Error(`Unable to find windowId=${details.windowId}`)
        }

        const tab = win.tabs.create()

        if (details.url) tab.loadURL(details.url)
        if (typeof details.active === 'boolean' ? details.active : true) win.tabs.select(tab.id)

        return [tab.webContents, tab.window]
      },
      selectTab: (tab, browserWindow) => {
        console.log('>> main.extensions.selectTab()')
        const win = this.getWindowFromBrowserWindow(browserWindow)
        win?.tabs.select(tab.id)
      },
      removeTab: (tab, browserWindow) => {
        console.log('>> main.extensions.removeTab()')
        const win = this.getWindowFromBrowserWindow(browserWindow)
        win?.tabs.remove(tab.id)
      },

      createWindow: async (details) => {
        console.log('>> main.extensions.createWindow()')
        await this.ready

        const win = this.createTabbedWindow({
          initialUrl: details.url,
        })
        // if (details.active) tabs.select(tab.id)
        return win.window
      },
      removeWindow: (browserWindow) => {
        console.log('>> main.extensions.removeWindow()')
        const win = this.getWindowFromBrowserWindow(browserWindow)
        win?.destroy()
      },
    })

    // Display <browser-action-list> extension icons.
    ElectronChromeExtensions.handleCRXProtocol(this.session)

    this.extensions.on('browser-action-popup-created', (popup) => {
      this.popup = popup
    })

    // Allow extensions to override new tab page
    this.extensions.on('url-overrides-updated', (urlOverrides) => {
      if (urlOverrides.newtab) {
        this.urls.newtab = urlOverrides.newtab
      }
    })

    // Messages from webui/settings
    ipcMain.handle('webui-message', async (ev, type, data) => {
      console.log('main.js received message from webui.js', type, data)

      let result
      switch (type) {
        case 'get-config-item':
          result = config.get(data.key)
          break
        case 'get-config':
          result = config.all
          break
        case 'set-config-item':
          result = config.set(data.key, data.value)
          if (data.key.startsWith('proxy.client.')) await win.applyProxy()
          else if (data.key == 'kc3kai.update.channel') {
            if (kc3ExtensionId) this.session.removeExtension(kc3ExtensionId)
            await this.updateKc3IfScheduled(win)
          } else if (data.key === 'window.style.brightness') {
            nativeTheme.themeSource = data.value
          } else if (data.key.startsWith('kc3kai.custom')) {
            const kc3Path = this.getKc3Path()
            await this.checkStartKc3(win, kc3Path)
          }
          break
        case 'kc3-doupdate':
          await this.updateKc3(config.get('kc3kai.update.channel'))
          break
        case 'kc3-get-isupdating':
          result = { isUpdating: this.kc3IsUpdating, channel: this.kc3UpdatingChannel }
          break
        case 'kc3-select-custom-location':
          const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory'],
          })
          result = { canceled, filePaths }
          break
        case 'webui-zoom-changed':
          console.log('zoom changed', data)
          win.tabs.updateLayout(data.height)
          break
        case 'webui-close-tab':
          console.log('clicked tab X', data)
          this.confirmCloseTab(data.tabId)
          break
      }
      return result
    })

    // extension containing window chrome UI
    const webuiExtension = await this.session.loadExtension(PATHS.WEBUI)
    webuiExtensionId = webuiExtension.id
    webuiUrl = `chrome-extension://${webuiExtensionId}/webui.html`

    // Wait for web store extensions to finish loading as they may change the
    // newtab URL.
    console.log('>> main: initializing webstore system...')
    await installChromeWebStore({
      session: this.session,
      async beforeInstall(details) {
        if (!details.browserWindow || details.browserWindow.isDestroyed()) return

        const title = `Add “${details.localizedName}”?`

        let message = `${title}`
        if (details.manifest.permissions) {
          const permissions = (details.manifest.permissions || []).join(', ')
          message += `\n\nPermissions: ${permissions}`
        }

        const returnValue = await dialog.showMessageBox(details.browserWindow, {
          title,
          message,
          icon: details.icon,
          buttons: ['Cancel', 'Add Extension'],
        })

        return { action: returnValue.response === 0 ? 'deny' : 'allow' }
      },
    })

    //if (!app.isPackaged) {
    if (fsSync.existsSync(PATHS.LOCAL_EXTENSIONS)) {
      console.log('>> main: loading extensions')
      await loadAllExtensions(this.session, PATHS.LOCAL_EXTENSIONS, {
        allowUnpacked: true,
        filterRegex: /^(?!kc3kai).*(?:[/\\]src)?$/,
      })
    }

    console.log('>> main: starting extension workers...')
    await Promise.all(
      this.session.getAllExtensions().map(async (extension) => {
        const manifest = extension.manifest
        if (manifest.manifest_version === 3 && manifest?.background?.service_worker) {
          await this.session.serviceWorkers.startWorkerForScope(extension.url).catch((error) => {
            console.error(error)
          })
        }
      }),
    )

    // theme handling
    const bright = config.get('window.style.brightness') || 'system'
    nativeTheme.themeSource = bright
    nativeTheme.on('updated', (ev) => {
      console.log('nativeTheme.updated', ev)
    })

    // initial window creation
    const webuiBase = 'chrome-extension://' + webuiExtensionId
    newTabUrl = webuiBase + '/new-tab.html'
    settingsUrl = webuiBase + '/settings.html'
    console.log('>> main: now creating window...')
    const win = this.createTabbedWindow({
      initialUrls: [settingsUrl],
      hideAddressBarFor: [settingsUrl],
    })

    //this.createInitialWindow()
    this.resolveReady()

    // set up kc3 update worker thread
    console.log('>> main: starting kc3 update service')

    //const workerUrl = new URL('./workers/kc3update-worker.js', import.meta.url)
    //this.kc3UpdateWorker = new Worker(path.join(PATHS.WORKERS,'kc3update-worker.js'))
    this.kc3UpdateWorker = new kc3UpdateWorker()
    this.kc3UpdateWorker.on('message', async (msg) => {
      //console.log('main.js received message from KC3 update worker', msg)
      // msg: { type, data }
      if (!msg?.type)
        throw new Error('Messages sent from worker must be in the format { type, data }')
      switch (msg.type) {
        case 'status-kc3-is-updating':
          this.kc3IsUpdating = msg.data.isUpdating
          this.kc3UpdatingChannel = msg.data.channel
          console.log('>> main: sending webui-message', msg.type)
          win.webContents.send('webui-message', { type: msg.type, data: msg.data })
          break
        case 'error-do-update':
        case 'update-process-started':
        case 'update-process-progress':
          console.log('>> main: sending webui-message', msg.type)
          win.webContents.send('webui-message', { type: msg.type, data: msg.data })
          break
        case 'update-process-completed':
          console.log('Received completion report from KC3 updater.')
          win.webContents.send('webui-message', { type: msg.type, data: msg.data })

          if (msg.data.name === 'KC3 Update') {
            const kc3Path = this.getKc3Path()
            if (!kc3Path) {
              console.log('No kc3 path provided.')
              return
            }
            const channel = this.kc3UpdatingChannel
            if (!channel.startsWith('custom'))
              await config.set('kc3kai.update.time.' + channel, Date.now())
            await this.checkStartKc3(win, kc3Path)
          }
          break
        default:
          throw new Error(`Unknown message type ${msg.type}`)
      }
    })
    await this.updateKc3IfScheduled(win)
  }

  initSession() {
    console.log('>> main.initSession()')
    this.session = session.defaultSession

    // Remove Electron and App details to closer emulate Chrome's UA
    const userAgent = this.session
      .getUserAgent()
      .replace(/\sElectron\/\S+/, '')
      .replace(new RegExp(`\\s${app.getName()}/\\S+`), '')
    this.session.setUserAgent(userAgent)

    this.session.serviceWorkers.on('running-status-changed', (event) => {
      console.info(`service worker ${event.versionId} ${event.runningStatus}`)
    })

    if (process.env.SHELL_DEBUG) {
      this.session.serviceWorkers.once('running-status-changed', () => {
        const tab = this.windows[0]?.getFocusedTab()
        if (tab) {
          tab.webContents.inspectServiceWorker()
        }
      })
    }
  }

  createTabbedWindow(options) {
    console.log('>> main.createWindow()')
    const windowState = config.get('window.state')

    const win = new TabbedBrowserWindow({
      ...options,
      urls: this.urls,
      extensions: this.extensions,
      window: {
        width: windowState?.width || defaultConfig.window.state.width,
        height: windowState?.height || defaultConfig.window.state.height,
        frame: false,
        titleBarStyle: 'hidden',
        // remove the min/max/close buttons so we can theme them
        /*titleBarOverlay: {
          height: 31,
          color: '#39375b',
          symbolColor: '#ffffff',
        },//*/
        webPreferences: {
          sandbox: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: true,
          enableRemoteModule: false,
          contextIsolation: true,
          worldSafeExecuteJavaScript: true,
        },
        icon: path.join(__dirname, 'icon.ico'),
      },
    })
    win.window.on('resize', () => {
      if (win.window.isMaximized()) return
      const size = win.window.getSize()
      config.set('window.state.width', size[0])
      config.set('window.state.height', size[1])
    })
    this.windows.push(win)

    if (process.env.SHELL_DEBUG) {
      win.webContents.openDevTools({ mode: 'detach' })
    }

    return win
  }

  createInitialWindow() {
    console.log('>> main.createInitialWindow()')
    this.createTabbedWindow()
  }

  async onWebContentsCreated(event, webContents) {
    console.log('>> main.onWebContentsCreated()')
    const browser = this
    const type = webContents.getType()
    const url = webContents.getURL()
    //console.log(`'web-contents-created' event [type:${type}, url:${url}]`)

    if (process.env.SHELL_DEBUG && ['backgroundPage', 'remote'].includes(webContents.getType())) {
      console.log('>> main: opening devtools')
      webContents.openDevTools({ mode: 'detach', activate: true })
    }

    webContents.setWindowOpenHandler((details) => {
      switch (details.disposition) {
        case 'foreground-tab':
        case 'background-tab':
        case 'new-window': {
          console.log('>> main: webContents.setWindowOpenHandler()', details.disposition)
          return {
            action: 'allow',
            outlivesOpener: true,
            createWindow: (options) => {
              const { webContents: guest, webPreferences } = options
              console.log('>> main: creating window', details, guest)
              const win = this.getWindowFromWebContents(webContents)
              console.log('>> main: creating tab', details, guest)
              const opts = {}
              if (guest) opts.webContents = guest
              if (webPreferences) opts.webPreferences = webPreferences
              const tab = win.tabs.create(opts)
              let ogurl = details.url
              tab.loadURL(details.url)
              if (
                (details.url == kc3StartPageUrl || ogurl == DMMPageUrl) &&
                config.get('kc3kai.startup.openDevtools')
              ) {
                tab.webContents.openDevTools({ activate: true })
              }
              return tab.webContents
            },
          }
        }
        default:
          return { action: 'allow' }
      }
    })

    webContents.on('context-menu', (event, params) => {
      const menu = buildChromeContextMenu({
        params,
        webContents,
        extensionMenuItems: this.extensions.getContextMenuItems(webContents, params),
        openLink: (url, disposition) => {
          const win = this.getFocusedWindow()

          switch (disposition) {
            case 'new-window':
              this.createTabbedWindow({ initialUrl: url })
              break
            default:
              const tab = win.tabs.create()
              tab.loadURL(url)
          }
        },
      })

      menu.popup()
    })

    webContents.on('zoom-changed', (event, zoomDirection) => {
      console.log(">> webContents.on('zoom-changed')", zoomDirection)
      var currentZoom = webContents.getZoomFactor()
      const isWebui = webContents.mainFrame.url == webuiUrl
      let increment = isWebui ? 0.1 : 0.2
      let min = isWebui ? 0.5 : 0.2
      let max = isWebui ? 1.5 : 2.0

      if (zoomDirection === 'in') {
        webContents.zoomFactor = Math.min(max, currentZoom + increment)
      }
      if (zoomDirection === 'out') {
        webContents.zoomFactor = Math.max(min, currentZoom - increment)
      }
    })
  }

  confirmCloseTab(tabId) {
    const win = this.windows.find((w) => w.tabs.tabList.some((t) => t.id == tabId))
    const tab = win.tabs.tabList.find((t) => t.id == tabId)
    let leave = true
    // add other URLs requiring confirmation here
    if ([DMMPageUrl].includes(tab.webContents.mainFrame.url)) {
      const choice = dialog.showMessageBoxSync({
        type: 'question',
        buttons: ['Leave', 'Stay'],
        title: 'Do you want to leave this site?',
        message: 'Changes you made may not be saved.',
        defaultId: 0,
        cancelId: 1,
      })
      leave = choice === 0
    }
    if (leave) {
      tab.destroy()
    }
  }

  getKc3Path() {
    const currentChannel = config.get('kc3kai.update.channel')
    let kc3Path
    if (currentChannel.startsWith('custom'))
      kc3Path = config.get(`kc3kai.${currentChannel}Location`)
    else kc3Path = path.join(PATHS.KC3_EXTENSIONS, 'kc3kai-' + currentChannel)
    return kc3Path
  }

  async updateKc3IfScheduled(win) {
    // update if configured schedule warrants it
    const currentChannel = config.get('kc3kai.update.channel')
    const canUpdate = !currentChannel.startsWith('custom')
    const lastUpdated = config.get('kc3kai.update.time.' + currentChannel)
    const schedule = config.get('kc3kai.update.schedule')
    const autoUpdate = config.get('kc3kai.update.auto')
    const scheduleMap = {
      startup: 0,
      daily: 1,
      weekly: 7,
      manual: null,
    }
    let doUpdate = false
    if (canUpdate && autoUpdate && (!lastUpdated || scheduleMap[schedule] >= 0)) {
      if (!lastUpdated) doUpdate = true
      else {
        let date = new Date(lastUpdated)
        date.setDate(date.getDate() + scheduleMap[schedule])
        doUpdate = date < new Date()
        console.log('Next KC3 update scheduled for ', date)
      }
    }

    if (doUpdate) {
      await setTimeout(1000)
      await this.updateKc3(currentChannel)
    } else {
      const kc3Path = this.getKc3Path()
      await this.checkStartKc3(win, kc3Path)
    }
  }

  async updateKc3(channel) {
    this.kc3UpdateWorker.postMessage({
      type: 'do-update',
      data: { path: PATHS.KC3_EXTENSIONS, channel },
    })
  }

  async checkStartKc3(win, kc3Path) {
    if (!!this.currentKc3ExtensionId) {
      win.tabs.removeExtensionTabs(this.currentKc3ExtensionId)
    }

    if (!kc3Path) {
      console.log('No kc3 path defined.')
      return
    }

    const kc3SrcPath = path.join(kc3Path, 'src')
    if (fsSync.existsSync(kc3SrcPath)) kc3Path = kc3SrcPath
    console.log('Searching for KC3Kai in', kc3Path)

    // once we're updated and kc3 is loaded, remove the default new tab page
    // and open the kc3 start page + strat room

    const kc3 = await this.session.loadExtension(kc3Path)
    if (kc3) {
      console.log('KC3Kai loaded! ID: ', kc3.id)

      // open KC3 start page
      kc3ExtensionId = kc3.id
      this.currentKc3ExtensionId = kc3ExtensionId

      kc3StartPageUrl = 'chrome-extension://' + kc3ExtensionId + '/pages/game/direct.html'
      DMMPageUrl = 'http://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/'
      let startTab

      if (config.get('kc3kai.startup.openDMMPage')) {
        startTab = win.tabs.create({ initialUrl: DMMPageUrl })
      } else {
        if (config.get('kc3kai.startup.openStartPage'))
          startTab = win.tabs.create({ initialUrl: kc3StartPageUrl })
      }

      const kc3StratRoomUrl =
        'chrome-extension://' + kc3ExtensionId + '/pages/strategy/strategy.html'
      if (config.get('kc3kai.startup.openStratRoom')) {
        const stratRoomTab = win.tabs.create({ initialUrl: kc3StratRoomUrl })
        startTab = startTab || stratRoomTab
      }

      if (startTab) win.tabs.select(startTab.id)
    }
  }
}

//module.exports = Browser
export default Browser

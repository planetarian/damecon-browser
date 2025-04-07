const path = require('path')
const fsSync = require('fs')
const url = require('url')
const fs = fsSync.promises
const { app, session, BrowserWindow, Notification, globalShortcut, ipcMain, nativeTheme, dialog } = require('electron')
const ConfigStore = require('configstore')

const { Tabs } = require('./tabs')
const { ElectronChromeExtensions } = require('electron-chrome-extensions')
const { setupMenu } = require('./menu')
const { buildChromeContextMenu } = require('electron-chrome-context-menu')
const { Worker } = require('worker_threads')
const { setTimeout } = require('timers/promises')

const defaultConfig = {
  window: {
    state: {
      width: 1200,
      height: 800
    },
    style: {
      theme: 'andra',
      brightness: 'system'
    }
  },
  kc3kai: {
    update: {
      channel: 'release',
      schedule: 'daily',
      auto: true
    },
    startup: {
      openStartPage: true,
      openDMMPage: false,
      openDevtools: true,
      openStratRoom: true
    }
  },
  proxy: {
    client: {
      host: '127.0.0.1',
      port: 8081,
      enable: false
    }
  }
}
const config = new ConfigStore('damecon-browser', defaultConfig, {globalConfigPath: true});

const rootPath = app.isPackaged ? app.getAppPath() : __dirname;
const browserPath = app.isPackaged ? path.join(app.getAppPath(), 'browser') : __dirname;
const extensionsPath = path.join(__dirname, '../../../extensions')

app.commandLine.appendSwitch("force-gpu-mem-available-mb", "10000")
app.commandLine.appendSwitch("force-gpu-rasterization")
app.commandLine.appendSwitch("enable-native-gpu-memory-buffers")
app.commandLine.appendSwitch("enable-gpu-memory-buffer-compositor-resources")
app.commandLine.appendSwitch("enable-experimental-web-platform-features");

if (process.execPath.match(/(damecon(-browser)?|chrome)/)) {
  currPath = path.dirname(process.execPath)
  let p = path.join(currPath, 'userdata')
  app.setPath('userData', p)
} else {
  // app.commandLine.appendSwitch('proxy-server', '192.168.0.123:1235')
}

let webuiExtensionId
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
        if (dirEnt.name.startsWith('kc3kai-'))
          return false;
          

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
      })
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
    this.session = options.session || session.defaultSession
    this.extensions = options.extensions
    // Can't inheret BrowserWindow
    // https://github.com/electron/electron/issues/23#issuecomment-19613241
    this.window = new BrowserWindow(options.window)
    this.id = this.window.id
    this.webContents = this.window.webContents

    const webuiUrl = path.join('chrome-extension://', webuiExtensionId, '/webui.html')
    this.webContents.loadURL(webuiUrl)
    if (process.env.SHELL_DEBUG) {
      this.webContents.openDevTools({mode: 'detach'})
    }
    
    this.tabs = new Tabs(this.window, { newTabPageUrl: newTabUrl, hideAddressBarFor: options.hideAddressBarFor })

    const self = this

    this.tabs.on('tab-created', function onTabCreated(tab) {
      // Track tab that may have been created outside of the extensions API.
      self.extensions.addTab(tab.webContents, tab.window)
    })

    this.tabs.on('tab-navigated', function onTabNavigated(tab, tabUrl) {
      if ((tabUrl === kc3StartPageUrl || tabUrl === DMMPageUrl) && config.get('kc3kai.startup.openDevtools')) {
        tab.webContents.openDevTools({activate: true })
      }
    })

    this.tabs.on('tab-selected', function onTabSelected(tab) {
      self.extensions.selectTab(tab.webContents)
    })

    this.tabs.on('tabs-hidden', function onTabsHidden(hidden) {
      self.webContents.send('webui-message', {message: 'tabs-hidden', value: hidden})
    })

    queueMicrotask(async () => {
      await this.applyProxy()
      this.tabs.create({initialUrl: settingsUrl})
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
      '203.104.209.102'
    ];
    const gadget = 'w00g.kancolle-server.com';
    //const gadget = '203.104.209.7';

    const ipsExp = ips.join('|');
    const pac = 'function FindProxyForURL(url, host) {\n'
    + `  if (shExpMatch(url, "http://(${ipsExp})/(kcs|kcs2)/*") || host == "${gadget}")\n`
    + `    return "PROXY ${host}:${port}";\n`
    + '  return "DIRECT";\n'
    + '}\n';

    return pac;
  };

  async applyProxy() {
    const enable = config.get('proxy.client.enable')
    if (enable) {
      const host = config.get('proxy.client.host')
      const port = config.get('proxy.client.port')
      const data = this.generatePac(host, port);
      const pacData = 'data:application/x-ns-proxy-autoconfig;base64,' + Buffer.from(data, 'utf8').toString('base64')
      const proxyConfig = { mode: 'pac_script', pacScript: pacData };
      await this.window.webContents.session.setProxy(proxyConfig)
    }
    else {
      await this.window.webContents.session.setProxy({ mode: 'system' })
    }
  };
}

class Browser {
  windows = []
  currentKc3ExtensionId = null

  constructor() {
    app.whenReady().then(this.init.bind(this))

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        this.destroy()
      }
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

    app.on("browser-window-focus", () => {
      globalShortcut.registerAll(["CommandOrControl+W"], () => { return; });
    });
    app.on("browser-window-blur", () => {
      globalShortcut.unregisterAll();
    });

    const browserPreload = path.join(__dirname, '../preload.js')
    this.session.setPreloads([browserPreload])

    this.extensions = new ElectronChromeExtensions({
      session: this.session,

      createTab: (details) => {
        const win =
          typeof details.windowId === 'number' &&
          this.windows.find((w) => w.id === details.windowId)

        if (!win) {
          throw new Error(`Unable to find windowId=${details.windowId}`)
        }

        const tab = win.tabs.create()

        if (details.url) tab.loadURL(details.url || newTabUrl)
        if (typeof details.active === 'boolean' ? details.active : true) win.tabs.select(tab.id)

        return [tab.webContents, tab.window]
      },
      selectTab: (tab, browserWindow) => {
        const win = this.getWindowFromBrowserWindow(browserWindow)
        win?.tabs.select(tab.id)
      },
      deselect: (browserWindow) => {
        const win = this.getWindowFromBrowserWindow(browserWindow)
        win?.tabs.select(tab.id)
      },
      removeTab: (tab, browserWindow) => {
        const win = this.getWindowFromBrowserWindow(browserWindow)
        win?.tabs.remove(tab.id)
      },

      createWindow: (details) => {
        const win = this.createWindow(details)
        // if (details.active) tabs.select(tab.id)
        return win.window
      },
      removeWindow: (browserWindow) => {
        const win = this.getWindowFromBrowserWindow(browserWindow)
        win?.destroy()
      },
    })

    this.extensions.on('browser-action-popup-created', (popup) => {
      this.popup = popup
    })

    // extension containing window chrome UI
    const webuiExtension = await this.session.loadExtension(path.join(__dirname, 'ui'))
    webuiExtensionId = webuiExtension.id
    
    // theme handling
    const bright = config.get('window.style.brightness') || 'system';
    nativeTheme.themeSource = bright;
    nativeTheme.on('updated', ev => {
      console.log('nativeTheme.updated', ev)
    });
    
    // initial window creation
    const webuiBase = 'chrome-extension://' + webuiExtensionId
    newTabUrl = webuiBase + '/new-tab.html'
    settingsUrl = webuiBase + '/settings.html'
    const win = this.createWindow({ initialUrls: [settingsUrl], hideAddressBarFor: [settingsUrl] })

    // load non-kc3 extensions
    const installedExtensions = await loadExtensions(this.session, extensionsPath)

    // set up kc3 update worker thread
    this.kc3UpdateWorker = new Worker(path.join(browserPath, './kc3update-worker.js'))
    this.kc3UpdateWorker.on('message', async msg => {
      //console.log('main.js received message from KC3 update worker', msg)
      // msg: { type, data }
      if (!msg?.type)
        throw new Error('Messages sent from worker must be in the format { type, data }');
      switch (msg.type) {
        case 'status-kc3-is-updating':
          this.kc3IsUpdating = msg.data.isUpdating
          this.kc3UpdatingChannel = msg.data.channel
          win.webContents.send('webui-message', {type: msg.type, data: msg.data})
          break;
        case 'error-do-update':
        case 'update-process-started':
        case 'update-process-progress':
          win.webContents.send('webui-message', {type: msg.type, data: msg.data})
          break;
        case 'update-process-completed':
          console.log('Received completion report from KC3 updater.')
          win.webContents.send('webui-message', {type: msg.type, data: msg.data})
          
          if (msg.data.name === 'KC3 Update') {
            const kc3Path = this.getKc3Path()
            if (!kc3Path) {
              console.log("No kc3 path provided.")
              return;
            }
            const channel = this.kc3UpdatingChannel;
            if (!channel.startsWith('custom'))
              await config.set('kc3kai.update.time.' + channel, Date.now())
            await this.checkStartKc3(win, kc3Path)
          }
          break;
        default:
            throw new Error(`Unknown message type ${msg.type}`);
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
          if (data.key.startsWith('proxy.client.'))
            await win.applyProxy()
          else if (data.key == 'kc3kai.update.channel') {
            if (kc3ExtensionId)
              this.session.removeExtension(kc3ExtensionId)
            await this.updateKc3IfScheduled(win)
          }
          else if (data.key === 'window.style.brightness') {
            nativeTheme.themeSource = data.value;
          }
          else if (data.key.startsWith('kc3kai.custom')) {
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
            properties: ['openDirectory']
          })
          result = { canceled, filePaths }
          break
      }
      return result;
    })

    await this.updateKc3IfScheduled(win)
  }

  getKc3Path() {
    const currentChannel = config.get('kc3kai.update.channel')
    let kc3Path
    if (currentChannel.startsWith('custom'))
      kc3Path = config.get(`kc3kai.${currentChannel}Location`)
    else
      kc3Path = path.join(extensionsPath, 'kc3kai-' + currentChannel)
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
      'startup': 0,
      'daily': 1,
      'weekly': 7,
      'manual': null
    }
    let doUpdate = false
    if (canUpdate && autoUpdate && (!lastUpdated || scheduleMap[schedule] >= 0)) {
      if (!lastUpdated)
        doUpdate = true
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

  initSession() {
    this.session = session.defaultSession

    // Remove Electron and App details to closer emulate Chrome's UA
    const userAgent = this.session
      .getUserAgent()
      .replace(/\sElectron\/\S+/, '')
      .replace(new RegExp(`\\s${app.getName()}/\\S+`), '')
    this.session.setUserAgent(userAgent)
  }

  createWindow(options) {
    const windowState = config.get('window.state');

    const win = new TabbedBrowserWindow({
      ...options,
      extensions: this.extensions,
      window: {
        width: windowState?.width || defaultConfig.window.state.width,
        height: windowState?.height || defaultConfig.window.state.height,
        frame: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegrationInWorker: true
          //, enableRemoteModule: true
        },
        icon: path.join(__dirname, 'icon.ico')
      },
    })
    win.window.on('resize', () => {
      if (win.window.isMaximized()) return;
      const size = win.window.getSize()
      config.set('window.state.width', size[0]);
      config.set('window.state.height', size[1]);
    })

    this.windows.push(win)

    if (process.env.SHELL_DEBUG) {
      win.webContents.openDevTools({ mode: 'detach' })
    }

    return win
  }

  async onWebContentsCreated(event, webContents) {
    const type = webContents.getType()
    const webContentsUrl = webContents.getURL()
    // console.log(`'web-contents-created' event [type:${type}, url:${webContentsUrl}]`)

    if (process.env.SHELL_DEBUG && webContents.getType() === 'backgroundPage') {
      webContents.openDevTools({ mode: 'detach', activate: true })
    }

    webContents.setWindowOpenHandler((details) => {
      switch (details.disposition) {
        case 'foreground-tab':
        case 'background-tab':
        case 'new-window': {
          // setWindowOpenHandler doesn't yet support creating BrowserViews
          // instead of BrowserWindows. For now, we're opting to break
          // window.open until a fix is available.
          // https://github.com/electron/electron/issues/33383
          queueMicrotask(() => {
            const win = this.getWindowFromWebContents(webContents)
            if (!win) return;
            const tab = win.tabs.create()
            let ogurl = details.url
            tab.loadURL(details.url)
            if ((details.url == kc3StartPageUrl || ogurl == DMMPageUrl) && config.get('kc3kai.startup.openDevtools')) {
              tab.webContents.openDevTools({activate: true });
            }
          })

          return { action: 'deny' }
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
        openLink: (linkUrl, disposition) => {
          const win = this.getFocusedWindow()

          switch (disposition) {
            case 'new-window':
              this.createWindow({ initialUrl: linkUrl })
              break
            default:
              const tab = win.tabs.create()
              tab.loadURL(linkUrl)
          }
        },
      })

      menu.popup()
    })

    webContents.on('will-prevent-unload', (event) => {
      const win = this.getWindowFromWebContents(webContents)
      const choice = dialog.showMessageBoxSync({
        type: 'question',
        buttons: ['Leave', 'Stay'],
        title: 'Do you want to leave this site?',
        message: 'Changes you made may not be saved.',
        defaultId: 0,
        cancelId: 1
      })
      const leave = (choice === 0)
      if (leave) {
        event.preventDefault()
      }
    })   

    webContents.on("zoom-changed", (event, zoomDirection) => {
        var currentZoom = webContents.getZoomFactor();
        if (zoomDirection === "in") {
          webContents.zoomFactor = currentZoom + 0.2;
        }
        if (zoomDirection === "out") {          
          webContents.zoomFactor = currentZoom - 0.2;
        }
    })
  }

  async updateKc3 (channel) {
    this.kc3UpdateWorker.postMessage({type: 'do-update', data: { path: extensionsPath, channel } });
  }

  async checkStartKc3 (win, kc3Path) {
    if (!!this.currentKc3ExtensionId) {
      win.tabs.removeExtensionTabs(this.currentKc3ExtensionId)
    }

    if (!kc3Path) {
      console.log('No kc3 path defined.')
      return
    }

    const kc3SrcPath = path.join(kc3Path, 'src')
    if (fsSync.existsSync(kc3SrcPath))
      kc3Path = kc3SrcPath
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
      }
      else {
        if (config.get('kc3kai.startup.openStartPage'))
          startTab = win.tabs.create({ initialUrl: kc3StartPageUrl })
      }
      
      const kc3StratRoomUrl = 'chrome-extension://' + kc3ExtensionId + '/pages/strategy/strategy.html'
      if (config.get('kc3kai.startup.openStratRoom')) {
        const stratRoomTab = win.tabs.create({ initialUrl: kc3StratRoomUrl })
        startTab = startTab || stratRoomTab
      }
  
      if (startTab)
        win.tabs.select(startTab.id)
    }
  }
}

module.exports = Browser
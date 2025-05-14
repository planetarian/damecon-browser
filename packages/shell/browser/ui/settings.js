ko.extenders.scrollFollow = function (target, selector) {
  target.subscribe(function (newval) {
    var el = document.querySelector(selector)

    // the scroll bar is all the way down, so we know they want to follow the text
    if (el?.hasOwnProperty('scrollTop') && el.scrollTop == el.scrollHeight - el.clientHeight) {
      // have to push our code outside of this thread since the text hasn't updated yet
      setTimeout(function () {
        el.scrollTop = el.scrollHeight - el.clientHeight
      }, 0)
    }
  })

  return target
}

class Settings {
  theme = ko.observable('andra')
  brightness = ko.observable('system')

  configPages = [
    {
      id: 0,
      name: 'Damecon',
      img: 'assets/icons/damecon_icon_48.png',
    },
    {
      id: 1,
      name: 'KC3Kai',
      img: 'assets/icons/kc3kai.png',
    },
    {
      id: 2,
      name: 'Proxy',
      img: 'assets/icons/kccp.png',
      //faIcon: 'fa-solid fa-circle-nodes'
    },
    {
      id: 3,
      name: 'Downloads',
      img: 'assets/icons/download_icon_48.png',
      //faIcon: 'fa-solid fa-download',
    },
  ]

  config = {}
  kccpConfig = {
    current: ko.observable(),
    modInfo: ko.observable(),
  }

  kccpModsOutOfDate = ko.pureComputed(() => {
    return this.kccpConfig
      .modInfo()
      .filter((m) => m.latestVersion && m.latestVersion != m.info.version).length
  })

  kccpStatus = ko.observable({ busy: false, started: false })
  kccpTab = ko.observable(0)
  // TODO: Don't reference UI stuff in VM
  kccpLogRecent = ko.observableArray([]).extend({ scrollFollow: '#kccp-log-scroller' })

  appLogRecent = ko.observableArray([]).extend({ scrollFollow: '#app-log-scroller' })

  logTypes = ['log', 'error']
  badgeClasses = {
    log: 'info',
    trace: 'warning',
    error: 'danger',
  }

  version = ''

  selectedConfigPage = ko.observable(0)

  // This sets up the mappings between knockout properties and config keys.
  settingsInitialized = ko.observable(false)

  processes = ko.observableArray([])

  newHideAddressBarSite = ko.observable('')
  canAddNewHideAddressBarSite = ko.computed(
    () =>
      !!this.newHideAddressBarSite() &&
      (!this.config.window.view.hideAddressBarSites() ||
        !this.config.window.view.hideAddressBarSites().includes(this.newHideAddressBarSite())),
    this,
  )

  kc3IsUpdating = ko.observable(false)
  kc3UpdatingChannel = ko.observable('')
  canSetKc3Channel = ko.computed(() => !this.kc3IsUpdating(), this)
  canUpdateKc3 = ko.observable(true)

  downloads = ko.observableArray([])

  async prepKccpConfig() {
    const current = await kccpConfigStore.all()
    this.kccpConfig.current(current.config)
    this.kccpConfig.modInfo(current.modInfo)
    this.prepKccpConfigItems()
  }

  prepKccpConfigItems() {
    const keys = [
      'hostname',
      'port',
      'cacheLocation',
      'disableBrowserCache',
      'verifyCache',
      'bypassGadgetUpdateCheck',
      'enableModder',
    ]
    const cfg = this.kccpConfig
    this.convertPropertiesToObservables(cfg.current(), {
      viewModel: cfg,
      keys,
    })
    for (const key of keys) {
      if (cfg[key].getSubscriptionsCount() === 0) {
        cfg[key].subscribe(async (newValue) => {
          cfg.current()[key] = newValue
          await kccpConfigStore.save(cfg.current())
        })
      }
    }
    if (!cfg.initialized) {
      cfg.useCacheLocation = ko.observable(cfg.cacheLocation() !== 'default')
      cfg.useCacheLocation.subscribe((newValue) => {
        if (!newValue) cfg.cacheLocation('default')
      })
      cfg.initialized = true
    }
  }

  async clearSessionCache() {
    await sendMessage('clear-cache')
  }

  kccpOpenLog() {
    this.kccpTab(0)
  }
  async kccpImportBasicCacheDump() {
    this.kccpOpenLog()
    await sendMessage('kccp-import-cache', { builtIn: true })
  }
  async kccpImportCacheDump() {
    this.kccpOpenLog()
    await sendMessage('kccp-import-cache', { builtIn: false })
  }
  async kccpReloadCache() {
    this.kccpOpenLog()
    await sendMessage('kccp-reload-cache')
  }
  async kccpVerifyCache() {
    this.kccpOpenLog()
    await sendMessage('kccp-verify-cache')
  }
  async kccpPrepatchAssets() {
    this.kccpOpenLog()
    await sendMessage('kccp-prepatch')
  }
  async kccpExtractSpritesheet() {
    await sendMessage('kccp-extract-spritesheet')
  }
  async kccpMakeOutlines() {
    await sendMessage('kccp-make-outlines')
  }
  async kccpConvertFromPoi() {
    await sendMessage('kccp-convert-poi')
  }

  async kccpAddMod() {
    await sendMessage('kccp-add-mod')
  }
  async kccpReloadMods() {
    await sendMessage('kccp-reload-mods')
  }
  async kccpRemoveMod(path) {
    const cfg = this.kccpConfig.current()
    const ind = cfg.mods.findIndex((m) => m.path == path)
    cfg.mods.splice(ind, 1)
    await kccpConfigStore.save(cfg)
  }
  async kccpMoveMod(path, dir) {
    const cfg = this.kccpConfig.current()
    const ind = cfg.mods.findIndex((m) => m.path == path)
    const mod = cfg.mods.find((m) => m.path == path)
    const newIdx = ind + dir
    if (newIdx < 0 || newIdx >= cfg.mods.length) {
      console.error('Tried to move a mod out of range.')
      return
    }
    cfg.mods.splice(ind, 1)
    cfg.mods.splice(ind + dir, 0, mod)
    await kccpConfigStore.save(cfg)
  }

  convertPropertiesToObservables(baseObj, opts) {
    const newObj = opts?.viewModel ?? {}
    for (const key of opts?.keys ?? Object.keys(baseObj)) {
      const isFunc = typeof newObj[key] === 'function'
      if (Array.isArray(baseObj[key])) {
        const newArr = baseObj[key].map((p) => ko.observable(p))
        if (isFunc) newObj[key](newArr)
        else newObj[key] = ko.observableArray(newArr)
      } else {
        if (isFunc) newObj[key](baseObj[key])
        else newObj[key] = ko.observable(baseObj[key])
      }
      if (opts?.subscribeCallback) {
        newObj[key].subscribe(opts.subscribeCallback)
      }
    }
    return newObj
  }

  selectConfigPage(item) {
    this.selectedConfigPage(item.id)
  }

  async tryInvoke(asyncCallback, name) {
    let result
    let tries = 5
    let error
    while (!result && tries-- > 0) {
      try {
        console.log(`>> invoking ${name ?? 'action'}...`)
        result = await asyncCallback()
        console.log(`>> received ${result}...`)
        return result
      } catch (err) {
        error = err

        console.error(
          ` >> got error while invoking ${name ?? 'action'}. ${tries > 0 ? 'retrying...' : 'giving up.'}`,
          err,
        )
      }
    }
    throw error
  }

  // loads values from the current config into ko properties
  async prepConfigProperties() {
    const config = await configStore.all()
    if (!config) throw error ?? 'Unknown error occurred fetching config.'
    configApplySync(config, this.prepConfigProperty.bind(this))

    this.theme(config.window.style.theme())
    config.window.style.theme.subscribe((newValue) => this.theme(newValue))
    this.brightness(config.window.style.brightness())
    config.window.style.brightness.subscribe((newValue) => this.brightness(newValue))
    return config
  }

  prepConfigProperty(path, config, key, keySchema) {
    // convert to observable
    let value = config[key]
    if (typeof config[key] !== 'function') {
      config[key] =
        keySchema.type == 'array' ? ko.observableArray(config[key]) : ko.observable(config[key])
    } else {
      value = config[key]()
    }
    if (config[key].getSubscriptionsCount() === 0) {
      config[key].subscribe((newValue) => {
        if (!this.settingsInitialized()) return
        console.log('>> setting changed', path, newValue)
        if (Array.isArray(newValue))
          newValue = newValue.map((v) => (typeof v === 'function' ? v() : v))
        configStore.set(path, newValue)
        if (path == 'kc3kai.update.channel') this.setCanUpdateKc3()
      })
    }

    // if it's an array, prepare observables for its members
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'function') value[i] = ko.observable(value[i])

        if (value[i].getSubscriptionsCount() === 0) {
          value[i].subscribe((newValue) => {
            if (!this.settingsInitialized()) return
            console.log('setting changed', `${path}[${i}]`, newValue)
            configStore.set(
              path,
              value.map((v) => v()),
            )
          })
        }
      }
    }
    let prop = config[key]
    prop(value)
  }

  // updates the config from ko properties
  async saveConfig() {
    await configApply(this.config, async (path, config, key, keySchema) => {
      let value = config[key]
      if (Array.isArray(value)) value = value.map((v) => v())
      await configStore.set(path, value)
    })
  }

  async kc3CheckForUpdates() {
    await sendMessage('kc3-doupdate')
  }

  addNewHideAddressBarSite() {
    const site = this.newHideAddressBarSite()
    if (!this.canAddNewHideAddressBarSite()) return
    this.newHideAddressBarSite('')
    if (!Array.isArray(this.config.window.view.hideAddressBarSites()))
      this.config.window.view.hideAddressBarSites([])
    const newItem = ko.observable(site)
    this.config.window.view.hideAddressBarSites.push(newItem)
    this.prepConfigProperty(
      'window.view.hideAddressBarSites',
      this.config.window.view,
      'hideAddressBarSites',
    )
  }
  removeHideAddressBarSite(value) {
    this.config.window.view.hideAddressBarSites.remove((v) => v() === value)
  }

  addNewProcess(data) {
    const p = {
      name: data.name,
      phase: ko.observable(''),
      current: ko.observable(0),
      total: ko.observable(0),
    }
    p.progressPct = ko.computed(() => {
      return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 }).format(
        (p.current() / p.total()) * 100,
      )
    })
    p.progress = ko.computed(() => {
      return p.total() > 0 ? `${p.current()}/${p.total()} (${p.progressPct()}%)` : ''
    })
    this.processes.push(p)
  }

  async getCustomKc3Path() {
    const channel = this.config.kc3kai.update.channel()
    if (!channel.startsWith('custom')) {
      console.error('Custom kc3 channel not selected.')
      return
    }
    const result = await sendMessage('kc3-select-custom-location')
    if (result.canceled || !result.filePaths.length) return
    const path = result.filePaths[0]
    console.log('Selected kc3 path', path)

    if (channel === 'custom1') this.config.kc3kai.update.custom1Location(path)
    else if (channel === 'custom2') this.config.kc3kai.update.custom2Location(path)
    else console.error('Unknown custom kc3 channel', channel)
  }

  async getCustomDataPath() {
    const loc = this.config.app.data.location()
    if (loc != 'custom') {
      console.error('Custom data location not selected.')
      return
    }
    const result = await sendMessage('select-custom-data-location')
    if (result.canceled || !result.filePaths.length) return
    const path = result.filePaths[0]
    console.log('Selected data path', path)

    this.config.app.data.customPath(path)
  }

  friendlySize(bytes, decimals = 2) {
    let received = bytes
    if (received < 1024) return `${received}bytes`
    received = (bytes / 1024).toFixed(decimals)
    if (received < 1024) return `${received}KB`
    received = (bytes / Math.pow(1024, 2)).toFixed(decimals)
    if (received < 1024) return `${received}MB`
    received = (bytes / Math.pow(1024, 3)).toFixed(decimals)
    return `${received}GB`
  }

  prepDownload(item) {
    const dl = this.convertPropertiesToObservables(item)
    dl.file = ko.pureComputed(() => {
      const split = (dl.filename() || dl.url()).split(/\\|\//)
      return split[split.length - 1]
    })
    if (!dl.endTime) dl.endTime = ko.observable()
    if (!dl.estimatedEndTime) dl.estimatedEndTime = ko.observable()

    dl.received = ko.pureComputed(() => this.friendlySize(dl.bytesReceived()))
    dl.total = ko.pureComputed(() => this.friendlySize(dl.totalBytes()))
    dl.progressPct = ko.pureComputed(() =>
      dl.totalBytes() > 0 && dl.bytesReceived() >= 0
        ? dl.bytesReceived() / dl.totalBytes()
        : undefined,
    )

    dl.open = () => chrome.downloads.open(dl.id())
    dl.openFolder = () => chrome.downloads.show(dl.id())
    dl.pause = () => chrome.downloads.pause(dl.id())
    dl.resume = () => chrome.downloads.resume(dl.id())
    dl.deleteFile = () => chrome.downloads.removeFile(dl.id())
    dl.erase = () => chrome.downloads.erase({ id: dl.id() })
    return dl
  }

  addBrowserListeners() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      ;(async () => {
        let result
        try {
          switch (msg.type) {
            case 'status-kc3-is-updating':
              this.kc3IsUpdating(msg.data.isUpdating)
              this.kc3UpdatingChannel(msg.data.channel)
              break
            case 'error-do-update':
              // TODO: report the error
              break
            case 'update-process-started':
              console.log('process started', msg.data.name)
              this.addNewProcess(msg.data)
              break
            case 'update-process-progress':
              const processToUpdate = this.processes().find((p) => p.name == msg.data.name)
              if (!processToUpdate) {
                this.addNewProcess(msg.data)
              }
              processToUpdate.phase(msg.data.phase)
              processToUpdate.current(msg.data.current)
              processToUpdate.total(msg.data.total)
              break
            case 'update-process-completed':
              console.log('process completed', msg.data.name)
              const processToRemove = this.processes().find((p) => p.name == msg.data.name)
              this.processes.remove(processToRemove)
              break
            case 'kccp-config-saved':
              await this.prepKccpConfig()
              break
            case 'kccp-status':
              this.kccpStatus(msg.data)
              break
            case 'kccp-log-update':
              if (!this.logTypes.includes(msg.data[2])) return
              if (msg.data[1].startsWith('kccp-')) this.kccpLogRecent.push(msg.data)
              else this.appLogRecent.push(msg.data)
              break
            case 'kccp-log-recent':
              msg.data.reverse()
              const kccpLog = msg.data.filter(
                (l) => l[1].startsWith('kccp-') && this.logTypes.includes(l[2]),
              )
              const appLog = msg.data.filter(
                (l) => !l[1].startsWith('kccp-') && this.logTypes.includes(l[2]),
              )
              this.kccpLogRecent(kccpLog)
              this.appLogRecent(appLog)
              break
            default:
              throw new Error(`Unknown message type ${msg.type || '(none)'}`)
          }
          sendResponse({ result, complete: true })
        } catch (error) {
          sendResponse({ error, complete: false })
        }
      })()
      return true
    })

    chrome.downloads.onCreated.addListener((item) => this.downloads.push(this.prepDownload(item)))
    chrome.downloads.onChanged.addListener(async (downloadId, delta) => {
      const existing = this.downloads().find((d) => d.id() == delta.id)
      if (!existing) {
        console.error('received update for untracked download', delta)
        return
      }
      const results = await chrome.downloads.search({ id: delta.id })
      if (!results.length) {
        console.error(
          'received update for download but downloads api returned no results for its ID.',
          delta,
        )
        return
      }
      const dl = results[0]
      for (const key of Object.keys(dl)) {
        if (key == 'id') continue
        try {
          existing[key](dl[key])
        } catch (error) {
          console.error(error)
        }
      }
    })
    chrome.downloads.onErased.addListener((downloadId) => {
      const dl = this.downloads().find((d) => d.id() == downloadId)
      if (!dl) return
      this.downloads.remove(dl)
    })
  }

  async clearFinishedDownloads() {
    await chrome.downloads.erase({ state: 'complete' })
    await chrome.downloads.erase({ state: 'interrupted' })
  }

  setCanUpdateKc3() {
    this.canUpdateKc3(!this.kc3IsUpdating() && !!this.config?.kc3kai?.update.channel())
  }

  constructor() {
    this.init()
  }
  async init() {
    const appInfo = await this.tryInvoke(
      async () => await sendMessage('get-damecon-info'),
      'get-damecon-info',
    )
    this.paths = appInfo.paths
    this.version = appInfo.version
    this.kccpStatus(appInfo.kccpStatus)

    await this.prepKccpConfig()

    this.config = await this.prepConfigProperties()
    console.log('done prepping config', this.config)
    this.settingsInitialized(true)

    const downloads = await chrome.downloads.search({})
    downloads.forEach((d) => this.downloads.push(this.prepDownload(d)))

    this.addBrowserListeners()

    const updateStatus = await sendMessage('kc3-get-isupdating')
    this.kc3IsUpdating.subscribe((newValue) => this.setCanUpdateKc3())
    this.kc3IsUpdating(updateStatus.isUpdating)
    this.kc3UpdatingChannel(updateStatus.channel)

    await sendMessage('kccp-log-get-recent')
  }
}
window.vm = new Settings()
$(document).ready(() => ko.applyBindings(window.vm))

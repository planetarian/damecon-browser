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
      //img: 'assets/icons/kccp.png',
      faIcon: 'fa-solid fa-download',
    },
  ]

  config = {}

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
  )

  kc3IsUpdating = ko.observable(false)
  kc3UpdatingChannel = ko.observable('')
  canSetKc3Channel = ko.computed(() => !this.kc3IsUpdating())
  canUpdateKc3 = ko.computed(
    () => !this.kc3IsUpdating() && !!this.config?.kc3kai?.update?.channel(),
  )

  downloads = ko.observableArray([])

  convertPropertiesToObservables(obj) {
    const newObj = {}
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key]))
        newObj[key] = ko.observableArray(obj[key].map((p) => ko.observable(p)))
      else newObj[key] = ko.observable(obj[key])
    }
    return newObj
  }

  selectConfigPage(item) {
    this.selectedConfigPage(item.id)
  }

  // loads values from the current config into ko properties
  async prepConfigProperties() {
    let config
    let tries = 0
    let error
    while (!config && tries++ < 3) {
      try {
        console.log('>> fetching config...')
        config = await configStore.all()
        console.log('  >> got config', config)
      } catch (err) {
        error = err
        console.log('  >> got error', err)
        // TODO: actually fix this
        console.error('!! ERROR !! settings fetch bug encountered. trying again..')
      }
    }
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

  async getKc3Location() {
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
    dl.erase = () => chrome.downloads.erase(dl.id())
    return dl
  }

  addBrowserListeners() {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
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

  constructor() {
    this.init()
  }
  async init() {
    this.canSetKc3Channel.subscribe((newValue) => console.log('canSetKc3Channel:', newValue))
    this.canUpdateKc3.subscribe((newValue) => console.log('canUpdateKc3:', newValue))
    this.config = await this.prepConfigProperties()
    console.log('done prepping config', this.config)
    this.settingsInitialized(true)

    const downloads = await chrome.downloads.search({})
    downloads.forEach((d) => this.downloads.push(this.prepDownload(d)))

    this.addBrowserListeners()

    const updateStatus = await sendMessage('kc3-get-isupdating')
    this.kc3IsUpdating(updateStatus.isUpdating)
    this.kc3UpdatingChannel(updateStatus.channel)
  }
}
window.vm = new Settings()
$(document).ready(() => ko.applyBindings(window.vm))

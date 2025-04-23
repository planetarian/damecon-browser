function ViewModel() {
  const self = this

  self.theme = ko.observable('andra')
  self.brightness = ko.observable('system')

  self.configPages = [
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
  ]

  self.config = {}

  self.selectConfigPage = function (item) {
    self.selectedConfigPage(item.id)
  }

  // loads values from the current config into ko properties
  self.prepConfigProperties = async function () {
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
    configApplySync(config, self.prepConfigProperty)

    self.theme(config.window.style.theme())
    config.window.style.theme.subscribe(newValue => self.theme(newValue))
    self.brightness(config.window.style.brightness())
    config.window.style.brightness.subscribe(newValue => self.brightness(newValue))
    return config
  }

  self.prepConfigProperty = function (path, config, key, keySchema) {
    // convert to observable
    let value = config[key]
    if (typeof config[key] !== 'function') {
      config[key] =
        keySchema.type == 'array' ? ko.observableArray(config[key]) : ko.observable(config[key])
    } else {
      value = config[key]()
    }
    if (config[key].getSubscriptionsCount() === 0) {
      config[key].subscribe(function (newValue) {
        if (!self.settingsInitialized()) return
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
            if (!self.settingsInitialized()) return
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
  self.saveConfig = async function () {
    await configApply(self.config, async (path, config, key, keySchema) => {
      let value = config[key]
      if (Array.isArray(value)) value = value.map((v) => v())
      await configStore.set(path, value)
    })
  }

  self.kc3CheckForUpdates = async function () {
    await sendMessage('kc3-doupdate')
  }

  self.selectedConfigPage = ko.observable(0)

  // This sets up the mappings between knockout properties and config keys.
  self.settingsInitialized = ko.observable(false)

  self.processes = ko.observableArray([])

  self.newHideAddressBarSite = ko.observable('')
  self.canAddNewHideAddressBarSite = ko.computed(
    () =>
      !!self.newHideAddressBarSite() &&
      (!self.config.window.view.hideAddressBarSites() ||
        !self.config.window.view.hideAddressBarSites().includes(self.newHideAddressBarSite())),
  )
  self.addNewHideAddressBarSite = () => {
    const site = self.newHideAddressBarSite()
    if (!self.canAddNewHideAddressBarSite()) return
    self.newHideAddressBarSite('')
    if (!Array.isArray(self.config.window.view.hideAddressBarSites()))
      self.config.window.view.hideAddressBarSites([])
    const newItem = ko.observable(site)
    self.config.window.view.hideAddressBarSites.push(newItem)
    this.prepConfigProperty(
      'window.view.hideAddressBarSites',
      self.config.window.view,
      'hideAddressBarSites',
    )
  }
  self.removeHideAddressBarSite = (value) => {
    self.config.window.view.hideAddressBarSites.remove((v) => v() === value)
  }

  self.kc3IsUpdating = ko.observable(false)
  self.kc3UpdatingChannel = ko.observable('')
  self.canSetKc3Channel = ko.computed(() => !self.kc3IsUpdating())
  self.canUpdateKc3 = ko.computed(
    () => !self.kc3IsUpdating() && !!self.config?.kc3kai?.update?.channel(),
  )
  self.canSetKc3Channel.subscribe((newValue) => console.log('canSetKc3Channel:', newValue))
  self.canUpdateKc3.subscribe((newValue) => console.log('canUpdateKc3:', newValue))

  self.addNewProcess = function (data) {
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
    self.processes.push(p)
  }

  self.getKc3Location = async function () {
    const channel = self.config.kc3kai.update.channel()
    if (!channel.startsWith('custom')) {
      console.error('Custom kc3 channel not selected.')
      return
    }
    const result = await sendMessage('kc3-select-custom-location')
    if (result.canceled || !result.filePaths.length) return
    const path = result.filePaths[0]
    console.log('Selected kc3 path', path)

    if (channel === 'custom1') self.config.kc3kai.update.custom1Location(path)
    else if (channel === 'custom2') self.config.kc3kai.update.custom2Location(path)
    else console.error('Unknown custom kc3 channel', channel)
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    ;(async () => {
      let result
      try {
        switch (msg.type) {
          case 'status-kc3-is-updating':
            self.kc3IsUpdating(msg.data.isUpdating)
            self.kc3UpdatingChannel(msg.data.channel)
            break
          case 'error-do-update':
            // TODO: report the error
            break
          case 'update-process-started':
            console.log('process started', msg.data.name)
            self.addNewProcess(msg.data)
            break
          case 'update-process-progress':
            const processToUpdate = self.processes().find((p) => p.name == msg.data.name)
            if (!processToUpdate) {
              self.addNewProcess(msg.data)
            }
            processToUpdate.phase(msg.data.phase)
            processToUpdate.current(msg.data.current)
            processToUpdate.total(msg.data.total)
            break
          case 'update-process-completed':
            console.log('process completed', msg.data.name)
            const processToRemove = self.processes().find((p) => p.name == msg.data.name)
            self.processes.remove(processToRemove)
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

  self.init = async function () {
    self.config = await self.prepConfigProperties()
    console.log('done prepping config', self.config)
    self.settingsInitialized(true)
    const updateStatus = await sendMessage('kc3-get-isupdating')
    self.kc3IsUpdating(updateStatus.isUpdating)
    self.kc3UpdatingChannel(updateStatus.channel)
  }

  self.init()
}
this.vm = new ViewModel()
$(document).ready(() => ko.applyBindings(this.vm))

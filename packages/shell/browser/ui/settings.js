this.viewModel = function () {
  const self = this
  self.configPages = ko.observableArray([
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
  ])

  self.selectConfigPage = function (item) {
    self.selectedConfigPage(item.id)
  }

  self.settingsApply = async function (callback) {
    for (let [groupKey, group] of Object.entries(self.settings)) {
      for (let [key, path] of Object.entries(self.settings[groupKey])) {
        await callback(key, path)
      }
    }
  }
  self.settingsApplySync = function (callback) {
    for (let [groupKey, group] of Object.entries(self.settings)) {
      for (let [key, path] of Object.entries(self.settings[groupKey])) {
        callback(key, path)
      }
    }
  }

  self.fetchConfig = async function () {
    const config = await configStore.all()
    self.settingsApplySync((key, path) => self[key](access(config, path)))
    self.settingsInitialized(true)
  }
  self.saveConfig = async function () {
    await self.settingsApply(async (key, path) => await configStore.set(path, self[key]()))
  }

  self.kc3CheckForUpdates = async function () {
    await sendMessage('kc3-doupdate')
  }

  self.selectedConfigPage = ko.observable(0)

  self.windowStyleThemes = ['andra', 'daybreak', 'savatieri', 'taiha', 'zuiun']
  self.windowStyleBrightnesses = ['system', 'light', 'dark']
  self.kc3GamePages = ['none', 'kc3', 'dmm']
  self.kc3UpdateChannels = ['release', 'master', 'develop', 'custom1', 'custom2']
  self.kc3UpdateSchedules = ['startup', 'daily', 'weekly', 'manual']

  // This sets up the mappings between knockout properties and config keys.
  self.settings = {
    window: {
      windowStyleTheme: 'window.style.theme',
      windowStyleBrightness: 'window.style.brightness',
    },
    kc3kai: {
      kc3GamePage: 'kc3kai.startup.gamePage',
      kc3OpenStartPage: 'kc3kai.startup.openStartPage', // TODO: remove
      kc3OpenDMMPage: 'kc3kai.startup.openDMMPage', // TODO: remove
      kc3OpenDevtools: 'kc3kai.startup.openDevtools',
      kc3OpenStratRoom: 'kc3kai.startup.openStratRoom',
      kc3UpdateChannel: 'kc3kai.update.channel',
      kc3Custom1Location: 'kc3kai.custom1Location',
      kc3Custom2Location: 'kc3kai.custom2Location',
      kc3UpdateSchedule: 'kc3kai.update.schedule',
      kc3UpdateAuto: 'kc3kai.update.auto',
    },
    proxy: {
      proxyClientHost: 'proxy.client.host',
      proxyClientPort: 'proxy.client.port',
      proxyClientEnable: 'proxy.client.enable',
    },
  }
  self.settingsInitialized = ko.observable(false)

  self.processes = ko.observableArray([])

  // initialize viewmodel items
  self.settingsApplySync((key, path) => {
    self[key] = ko.observable()
    self[key].subscribe(function (newValue) {
      if (!self.settingsInitialized()) return
      console.log('setting changed', path, newValue)
      configStore.set(path, newValue)
    })
  })

  self.windowStyleTheme.subscribe(
    (newValue) => (document.querySelector('body').dataset.colorTheme = newValue),
  )
  self.windowStyleBrightness.subscribe(
    (newValue) => (document.querySelector('body').dataset.brightness = newValue),
  )

  self.kc3IsUpdating = ko.observable(false)
  self.kc3UpdatingChannel = ko.observable('')
  self.canSetKc3Channel = ko.computed(() => !self.kc3IsUpdating())
  self.canUpdateKc3 = ko.computed(() => !self.kc3IsUpdating() && !!self.kc3UpdateChannel())
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
    const channel = self.kc3UpdateChannel()
    if (!channel.startsWith('custom')) {
      console.error('Custom kc3 channel not selected.')
      return
    }
    const result = await sendMessage('kc3-select-custom-location')
    if (result.canceled || !result.filePaths.length) return
    const path = result.filePaths[0]
    console.log('Selected kc3 path', path)

    if (channel === 'custom1') self.kc3Custom1Location(path)
    else if (channel === 'custom2') self.kc3Custom2Location(path)
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

  init()
}
const init = async function () {
  await self.fetchConfig()
  const updateStatus = await sendMessage('kc3-get-isupdating')
  self.kc3IsUpdating(updateStatus.isUpdating)
  self.kc3UpdatingChannel(updateStatus.channel)
}
$(document).ready(() => ko.applyBindings(this.viewModel))

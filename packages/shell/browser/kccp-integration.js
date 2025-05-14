import path from 'path'
import fsSync from 'fs'
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
import { setTimeout } from 'timers/promises'

// KCCP
const kccp = require('../../kccacheproxy/src/proxy/proxy.js')
const kccpCacher = require('../../kccacheproxy/src/proxy/cacher.js')
const kccpCacheHandler = require('../../kccacheproxy/src/proxy/cacheHandler.js')
const kccpModderUtils = require('../../kccacheproxy/src/proxy/mod/modderUtils.js')
const kccpPatcher = require('../../kccacheproxy/src/proxy/mod/patcher.js')

let kccpProxy
const kccpStatus = { started: false, busy: false, busyActions: 0 }

const logSource = 'kccp-integration'

const kccpIncBusy = function (amt) {
  kccpStatus.busyActions += amt
}

const kccpSendStatusUpdate = function () {
  kccpStatus.busy = kccpStatus.busyActions > 0
  try {
    const windows = BrowserWindow.getAllWindows()
    windows[0].webContents.send('webui-message', { type: 'kccp-status', data: kccpStatus })
  } catch (error) {
    kccp.logger.error("Couldn't send KCCacheProxy status update to window.")
  }
}

const getKccpConfig = async function (configStore) {
  let traceShown = false
  while (kccpStatus.busy) {
    kccp.logger.log(logSource, '(getKccpConfig): KCCacheProxy is currently busy; waiting.')
    if (!traceShown) kccp.logger.trace(logSource, 'startStopKccp')
    traceShown = true
    await setTimeout(1000)
  }

  kccpIncBusy(1)
  kccpSendStatusUpdate()
  try {
    const config = kccp.config.getConfig()
    const modInfo = []
    let modified = false

    for (const mod of config.mods) {
      const path = mod.path
      const exists = fsSync.existsSync(path)
      const info = {}
      Object.assign(info, mod)
      info.exists = exists

      if (!exists) {
        dialog.showMessageBoxSync(this, {
          type: 'info',
          buttons: ['OK'],
          title: 'Mod not found',
          message: `Couldn't find a KCCP mod in this location.\nlocation: ${mod.path}`,
        })
      } else {
        try {
          const modData = JSON.parse(fsSync.readFileSync(mod.path))
          info.info = modData
          if (modData.updateUrl) {
            if (mod.lastCheck == undefined || mod.lastCheck < Date.now() - 3 * 60 * 60 * 1000) {
              try {
                mod.lastCheck = Date.now()
                kccp.logger.log(logSource, `Checking for update for KCCP mod ${modData.name}`)
                const response = await fetch(modData.updateUrl)
                const updateJson = await response.json()
                //const oldVersion = mod.latestVersion
                mod.latestVersion = updateJson.version
                mod.url = updateJson.downloadUrl || updateJson.url || updateJson.updateUrl

                modified = true
              } catch (error) {
                kccp.logger.error(
                  logSource,
                  `failed to check for updates for KCCP mod ${mod.name} at ${mod.updateUrl}`,
                )
              }
            }
          }

          if (modData.requireScripts && !mod.allowScripts) {
            const message = `The mod '${modData.name}' (${mod.path}) requires scripts to be enabled. Do you trust this mod?`
            const resp = dialog.showMessageBoxSync(this, {
              type: 'question',
              buttons: ['Yes', 'No'],
              title: 'Mod Scripts',
              message,
            })
            if (resp == 1) {
              const ind = config.mods.indexOf(mod)
              config.mods.splice(ind, 1)
              continue
            }
            mod.allowScripts = true
            modified = true
          }
        } catch (error) {
          dialog.showMessageBoxSync(this, {
            type: 'info',
            buttons: ['OK'],
            title: 'Mod load error',
            message: `Failed to load metadata for mod.\nlocation: ${mod.path}\nerror:${error}`,
          })
        }
      }

      modInfo.push(info)
    }

    if (modified) {
      await setKccpConfig(config)
      await kccpPatcher.reloadModCache()
      await startStopKccp(configStore, kccpStatus.busyActions)
    }

    return { config, modInfo, modified }
  } finally {
    kccpIncBusy(-1)
    kccpSendStatusUpdate()
  }
}

const setKccpConfig = async function (kccpConfig) {
  await kccp.config.setConfig(kccpConfig, true)
  const windows = BrowserWindow.getAllWindows()
  if (windows.length == 0) {
    kccp.logger.log(logSource, 'No windows to report to.')
    return
  }
  windows[0].webContents.send('webui-message', {
    type: 'kccp-config-saved',
    data: { config: kccpConfig },
  })
}

const initKccp = function () {
  kccp.logger.registerElectron(ipcMain, app)
  kccp.config.loadConfig(app)
}

const startStopKccp = async function (configStore, expectedBusyActions = 0) {
  const enabled = configStore.get('proxy.enable')
  const mode = configStore.get('proxy.mode')
  let traceShown = false
  while (kccpStatus.busyActions > expectedBusyActions) {
    kccp.logger.log(logSource, '(startStopKccp): KCCacheProxy is currently busy; waiting.')
    //if (!traceShown)
    //kccp.logger.trace(logSource, 'startStopKccp')
    traceShown = true
    await setTimeout(1000)
  }
  kccpIncBusy(1)
  kccpStatus.started = false
  kccpSendStatusUpdate()
  try {
    if (enabled !== true || mode !== 'kccp-internal') {
      stopKccp()
      return
    }

    kccp.logger.log(logSource, `${kccpProxy ? 'Res' : 'S'}tarting KCCacheProxy`)

    if (kccpProxy) {
      kccpProxy.close()
      kccp.logger.log(logSource, 'Waiting for KCCacheProxy to stop listening.')
      while (kccpProxy.server.listening) {
        await setTimeout(10)
      }
      kccp.logger.log(logSource, 'KCCacheProxy has stopped listening.')
    }

    kccpProxy = new kccp.Proxy()
    await kccpProxy.init()
    await kccpProxy.start()
    kccp.logger.log(logSource, 'Waiting for KCCacheProxy to start listening.')
    while (!kccpProxy.server.listening) {
      await setTimeout(10)
    }
    kccp.logger.log(logSource, 'KCCacheProxy is now listening.')
  } catch (error) {
    kccp.logger.error(logSource, `Error occurred starting KCCacheProxy.`, error)
    stopKccp()
  } finally {
    kccpIncBusy(-1)
    kccpStatus.started = true
    kccpSendStatusUpdate()
  }
}

const stopKccp = function () {
  if (kccpProxy) {
    kccp.logger.log(logSource, 'Shutting down KCCacheProxy.')
    kccpProxy?.close()
    kccpProxy = undefined
  }
}

function getKccpCachePath(kccpConfig) {
  let cachePath = kccpConfig.cacheLocation
  if (
    !kccpConfig.cacheLocation ||
    kccpConfig.cacheLocation == undefined ||
    kccpConfig.cacheLocation == 'default'
  )
    cachePath = path.join(app.getPath('userData'), 'ProxyData', 'cache')
  return cachePath
}

function getKccpImgCachePath(kccpConfig) {
  let cachePath = getKccpCachePath(kccpConfig)
  cachePath = path.join(cachePath, 'kcs2', 'img')
  return cachePath
}

function getKccpModPath(kccpConfig) {
  return kccpConfig.mods.length > 0
    ? path.join(kccpConfig.mods[kccpConfig.mods.length - 1].path, '..')
    : undefined
}

function getKccpStatus() {
  return kccpStatus
}

export {
  getKccpStatus,
  kccpSendStatusUpdate,
  getKccpConfig,
  setKccpConfig,
  initKccp,
  startStopKccp,
  stopKccp,
  getKccpCachePath,
  getKccpImgCachePath,
  getKccpModPath,
}

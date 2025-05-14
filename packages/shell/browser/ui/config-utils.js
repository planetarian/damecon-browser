const configSchema = {
  app: {
    update: {
      auto: { type: 'bool', default: true },
    },
  },
  window: {
    state: {
      width: { type: 'number', default: 1200 },
      height: { type: 'number', default: 800 },
    },
    style: {
      theme: {
        type: 'option',
        options: ['andra', 'daybreak', 'savatieri', 'taiha', 'zuiun'],
        default: 'andra',
      },
      brightness: { type: 'option', options: ['system', 'light', 'dark'], default: 'system' },
    },
    view: {
      hideAddressBarSites: {
        type: 'array',
        default: [
          'http://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/',
          '{{kc3-extension}}/*',
        ],
      },
      alwaysShowExtensions: { type: 'bool', default: true },
      alwaysShowReload: { type: 'bool', default: true },
      alwaysShowBack: { type: 'bool', default: false },
      alwaysShowForward: { type: 'bool', default: false },
    },
  },
  kc3kai: {
    startup: {
      gamePage: { type: 'option', options: ['none', 'kc3', 'dmm'], default: 'kc3' },
      openStartPage: { type: 'bool' }, // TODO: remove
      openDMMPage: { type: 'bool' }, // TODO: remove
      openDevtools: { type: 'bool', default: true },
      openStratRoom: { type: 'bool', default: true },
    },
    update: {
      channel: {
        type: 'option',
        options: ['release', 'master', 'develop', 'custom1', 'custom2'],
        default: 'release',
      },
      schedule: {
        type: 'option',
        options: ['startup', 'daily', 'weekly', 'manual'],
        default: 'daily',
      },
      auto: { type: 'bool', default: true },
    },
    custom1Location: { type: 'string' },
    custom2Location: { type: 'string' },
  },
  proxy: {
    enable: { type: 'bool', default: false },
    mode: {
      type: 'option',
      options: ['kccp-external', 'kccp-internal', 'all-external'],
      default: 'kccp-external',
    },
    client: {
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'number', default: 8081 },
    },
  },
}

const configApply = async function (config, propertyCallback, schema = configSchema, path = '') {
  for (const key in schema) {
    const keyPath = path ? `${path}.${key}` : key
    const source = schema[key]
    if (source.type && typeof source.type == 'string') {
      //console.log(`> executing ${keyPath}`)
      // config property
      await propertyCallback(keyPath, config, key, source)
    } else {
      // sub-key
      if (!config.hasOwnProperty(key) || typeof config[key] != 'object') config[key] = {}
      //console.log(` \\ entering ${key} (${keyPath})`)
      await configApply(config[key], propertyCallback, source, keyPath)
    }
  }
  return config
}
const configApplySync = function (config, propertyCallback, schema = configSchema, path = '') {
  for (const key in schema) {
    const keyPath = path ? `${path}.${key}` : key
    const source = schema[key]
    if (source.type && typeof source.type == 'string') {
      //console.log(`> executing ${keyPath}`)
      // config property
      propertyCallback(keyPath, config, key, source)
    } else {
      // sub-key
      if (!config.hasOwnProperty(key) || typeof config[key] != 'object') config[key] = {}
      //console.log(` \\ entering ${key} (${keyPath})`)
      configApplySync(config[key], propertyCallback, source, keyPath)
    }
  }
  return config
}

const populateConfigDefaults = function (config, schema = configSchema) {
  configApplySync(
    config,
    (path, config, key, keySchema) => {
      if (
        typeof keySchema.default == 'undefined' ||
        (config.hasOwnProperty(key) && typeof config[key] != 'undefined')
      )
        return
      //console.log(keySchema)
      config[key] = keySchema.default
    },
    schema,
  )
}

if (typeof window !== 'undefined') {
  Object.assign(window, { configSchema, configApply, configApplySync, populateConfigDefaults })
}
if (typeof module !== 'undefined') {
  module.exports = { configSchema, configApply, configApplySync, populateConfigDefaults }
}

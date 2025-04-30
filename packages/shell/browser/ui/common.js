//
// Do not use from webui.js
// ... I mean you can, but you probably shouldn't
//

const sendMessage = function (type, data) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, data }, (response) => {
      console.log(`received response to ${type}: `, response)
      if (response?.complete) {
        resolve(response.result)
      } else {
        reject(
          `Failed to send message to UI (${JSON.stringify(response?.error)}): ${type ?? 'unknown-type'} ${JSON.stringify(data)}`,
        )
      }
    })
  })
}

const configStore = {
  set: async function (key, value) {
    return await sendMessage('set-config-item', { key, value })
  },
  get: async function (key) {
    return await sendMessage('get-config-item', { key })
  },
  all: async function () {
    return await sendMessage('get-config')
  },
}

const kccpConfigStore = {
  save: async function (config) {
    return await sendMessage('kccp-save-config', config)
  },
  all: async function () {
    return await sendMessage('kccp-get-config')
  },
}

//
// Rest are OK to use anywhere
//

// Access a node of an object tree via dot notation string ('foo.bar.baz')
const access = function (o, s) {
  s = s.replace(/\[(\w+)\]/g, '.$1') // convert indexes to properties
  s = s.replace(/^\./, '') // strip a leading dot
  var a = s.split('.')
  for (var i = 0, n = a.length; i < n; ++i) {
    var k = a[i]
    if (o === Object(o) && k in o) {
      o = o[k]
    } else {
      return
    }
  }
  return o
}

const sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))

const urlRegex =
  /^(?<base>(?:(?<scheme>[\w-]+:)(?<open>\/\/\/?)(?<cred>(?<user>[\w]*)(?::(?<pw>[\w]*))?@)?)?(?<host>[\d\w\.-]+?(?<tld>\.[\w]+)?)(?::(?<port>\d+))?)?(?:\/(?<path>[\/\\\w\.()-]*))?(?:(?<query>[?][^#]*)?(?<hash>#.*)?)*$/gim

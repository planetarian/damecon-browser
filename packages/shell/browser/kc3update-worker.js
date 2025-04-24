const { parentPort } = require('worker_threads')
const { KC3Updater } = require('./kc3updater.js')

let isUpdating = false
let channel

//processes = {};
const onProcessStarted = function (name) {
  parentPort.postMessage({ type: 'update-process-started', data: { name } })
}
const onProcessProgress = function (name, phase, current, total) {
  parentPort.postMessage({ type: 'update-process-progress', data: { name, phase, current, total } })
}
const onProcessCompleted = function (name) {
  parentPort.postMessage({ type: 'update-process-completed', data: { name } })
}

let kc3Updater = new KC3Updater({ onProcessStarted, onProcessProgress, onProcessCompleted })

parentPort.on('message', async (msg) => {
  console.log('kc3update-worker.js received message from Main', msg)
  // msg: { type, data }
  if (!msg?.type)
    throw new Error('Messages sent to update worker must be in the format { type, data }')

  switch (msg.type) {
    case 'get-is-updating':
      parentPort.postMessage({ type: 'status-kc3-is-updating', data: { isUpdating, channel } })
      break
    case 'do-update':
      if (!msg.data || !msg.data.path || !msg.data.channel)
        throw new Error('do-update data must be in the format { path, channel }')
      await doUpdate(msg.data.path, msg.data.channel)
      break
    default:
      throw new Error(`Unknown message type ${msg.type}`)
  }
})

const doUpdate = async function (extensionsPath, updateChannel) {
  if (isUpdating) {
    parentPort.postMessage({ type: 'error-do-update', data: 'Update already in progress.' })
    return
  }
  isUpdating = true
  channel = updateChannel
  parentPort.postMessage({ type: 'status-kc3-is-updating', data: { isUpdating, channel } })

  try {
    await kc3Updater.update(extensionsPath, updateChannel)
  } finally {
    isUpdating = false
    parentPort.postMessage({ type: 'status-kc3-is-updating', data: { isUpdating, channel } })
  }
}

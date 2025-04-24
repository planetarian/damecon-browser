import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'
import { injectIpc } from './preload-ipc.js'
import { contextBridge } from 'electron'

// Inject <browser-action-list> element into WebUI
if (location.protocol === 'chrome-extension:' && location.pathname === '/webui.html') {
  injectBrowserAction()
  injectIpc()
}

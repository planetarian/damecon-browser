import { Menu } from 'electron'

const setupMenu = (browser) => {
  const isMac = process.platform === 'darwin'

  const tab = () => browser.getFocusedWindow().getFocusedTab()
  const tabWc = () => tab().webContents

  // this menu is never actually visible but we can easily shove shortcuts here so hey
  // though realistically if we're gonna support the wider set of shortcuts
  // we probably should get away from using this
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          nonNativeMacOSRole: true,
          click: () => browser.getFocusedWindow().tabs.create(),
        },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          nonNativeMacOSRole: true,
          click: () => tabWc().reload(),
        },
        {
          label: 'ReloadF5',
          accelerator: 'F5',
          nonNativeMacOSRole: true,
          click: () => tabWc().reload(),
        },
        {
          label: 'Force Reload',
          accelerator: 'Shift+CmdOrCtrl+R',
          nonNativeMacOSRole: true,
          click: () => tabWc().reloadIgnoringCache(),
        },
        {
          label: 'Force ReloadF5',
          accelerator: 'CmdOrCtrl+F5',
          nonNativeMacOSRole: true,
          click: () => tabWc().reloadIgnoringCache(),
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+F4',
          nonNativeMacOSRole: true,
          click: () => browser.confirmCloseTab(tab().id),
        },
        {
          label: 'Close Tab2',
          accelerator: 'CmdOrCtrl+W',
          nonNativeMacOSRole: true,
          click: () => browser.confirmCloseTab(tab().id),
        },
        {
          label: 'Open devtools',
          accelerator: 'F12',
          nonNativeMacOSRole: true,
          click: () => tabWc().toggleDevTools(),
        },
        {
          label: 'Open devtools2',
          accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          nonNativeMacOSRole: true,
          click: () => tabWc().toggleDevTools(),
        },
        {
          label: 'Show Addressbar',
          accelerator: 'Alt+A',
          nonNativeMacOSRole: true,
          click: () => browser.renderToolbar(tab().id),
        },
        {
          label: 'Focus Addressbar',
          accelerator: 'Alt+D',
          nonNativeMacOSRole: true,
          click: () => browser.focusAddressBar(tab().id),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomIn', accelerator: 'CommandOrControl+=' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

export default setupMenu

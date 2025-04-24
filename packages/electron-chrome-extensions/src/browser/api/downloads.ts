import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import { getAllWindows, matchesPattern, matchesTitlePattern, TabContents } from './common'
import { WindowsAPI } from './windows'
import { download } from 'electron-dl'
import { app, BrowserWindow, dialog } from 'electron'
import path from 'path'
import debug from 'debug'

const d = debug('electron-chrome-extensions:downloads')

export class DownloadsAPI {
  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    handle('downloads.download', this.download.bind(this))
  }

  private download(event: ExtensionEvent, details: any) {
    console.log('>> downloads.download')
    console.log('event', event)
    console.log('details', details)

    const filePath = details.filename.split(path.sep)
    const filename = filePath.pop()
    const downloads = app.getPath('downloads')
    const directory = path.join(downloads, ...filePath)
    console.log('directory', directory)
    console.log('filename', filename)
    const win = BrowserWindow.getFocusedWindow() as BrowserWindow
    download(win, details.url, {
      saveAs: true,
      directory,
      filename,
    })
  }
}

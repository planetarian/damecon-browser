import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import { getAllWindows, matchesPattern, matchesTitlePattern, TabContents } from './common'
import { WindowsAPI } from './windows'
import { download } from 'electron-dl'
import { app, BrowserWindow, dialog, DownloadURLOptions } from 'electron'
import path from 'path'
import debug from 'debug'
import { DownloadItem } from 'electron/main'

const d = debug('electron-chrome-extensions:downloads')

class ApiDownload implements chrome.downloads.DownloadItem {
  bytesReceived: number = 0
  danger: chrome.downloads.DangerType = 'safe'
  url: string
  finalUrl: string
  totalBytes: number = 0
  filename: string
  paused: boolean = false
  state: chrome.downloads.DownloadState = 'in_progress'
  mime: string
  fileSize: number = 0
  startTime: string = new Date().toISOString()
  error?: chrome.downloads.DownloadInterruptReason | undefined
  endTime?: string | undefined
  id: number
  incognito: boolean = false
  referrer: string = ''
  estimatedEndTime?: string | undefined
  canResume: boolean = true
  exists: boolean = true
  byExtensionId?: string | undefined
  byExtensionName?: string | undefined
  constructor(id: number, url: string, finalUrl: string, filename: string, mime: string) {
    this.id = id
    this.url = url
    this.finalUrl = finalUrl
    this.filename = filename
    this.mime = mime
  }
}

class Download {
  download: ApiDownload
  sessDownload: DownloadItem
  constructor(download: ApiDownload, sessDownload: DownloadItem) {
    this.download = download
    this.sessDownload = sessDownload
  }
}
export class DownloadsAPI {
  private downloads: Download[] = []
  private pending: chrome.downloads.DownloadOptions[] = []
  private nextId: number = 1

  constructor(private ctx: ExtensionContext) {
    const handle = this.ctx.router.apiHandler()
    //handle('downloads.acceptDanger', this.acceptDanger.bind(this))
    handle('downloads.cancel', this.cancel.bind(this))
    handle('downloads.download', this.download.bind(this))
    handle('downloads.erase', this.erase.bind(this))
    //handle('downloads.getFileIcon', this.getFileIcon.bind(this))
    //handle('downloads.open', this.open.bind(this))
    handle('downloads.pause', this.pause.bind(this))
    //handle('downloads.removeFile', this.removeFile.bind(this))
    handle('downloads.resume', this.resume.bind(this))
    handle('downloads.search', this.search.bind(this))
    //handle('downloads.setUiOptions', this.setUiOptions.bind(this))
    //handle('downloads.show', this.show.bind(this))
    //handle('downloads.showDefaultFolder', this.showDefaultFolder.bind(this))
    this.ctx.session.on('will-download', (ev, item, wc) => {
      console.log('>> attempted to download', item.getURL())

      const mime = item.getMimeType()
      const urlChain = item.getURLChain()
      // if started from the downloads API, apply options
      const idx = this.pending.findIndex((p) => p.url == item.getURL())
      if (idx > -1) {
        const pend = this.pending.splice(idx, 1)[0]
        if (pend.filename) {
          const relPath = pend.filename.split('/').join(path.sep).split('\\').join(path.sep)
          const absPath = app.getPath('downloads') + path.sep + relPath
          item.setSavePath(absPath)
        }
      }
      const dl = new ApiDownload(
        this.nextId++,
        item.getURL(),
        urlChain[urlChain.length - 1],
        item.getSavePath(),
        mime,
      )

      const updateState = (
        state: 'progressing' | 'completed' | 'cancelled' | 'interrupted',
      ): chrome.downloads.DownloadDelta => {
        const delta: chrome.downloads.DownloadDelta = { id: dl.id }
        const newState = this.convertDownloadState(state)
        if (dl.state != newState) {
          delta.state = { previous: dl.state, current: newState }
          dl.state = newState
        }
        const paused = item.isPaused()
        if (dl.paused != paused) {
          delta.paused = { previous: dl.paused, current: paused }
          dl.paused = paused
        }
        const canResume = item.canResume()
        if (dl.canResume != canResume) {
          delta.canResume = { previous: dl.canResume, current: canResume }
          dl.canResume = canResume
        }
        const totalBytes = item.getTotalBytes()
        if (dl.totalBytes != totalBytes) {
          delta.totalBytes = { previous: dl.totalBytes, current: totalBytes }
          dl.totalBytes = totalBytes
        }
        const mime = item.getMimeType()
        if (dl.mime != mime) {
          delta.mime = { previous: dl.mime, current: mime }
          dl.mime = mime
        }

        dl.bytesReceived = item.getReceivedBytes()

        return delta
      }

      item.on('updated', (ev, state) => {
        const delta = updateState(state)
        console.log('* download updated', delta)
        console.log(`  progress: ${item.getReceivedBytes()}/${item.getTotalBytes()}`)
        this.ctx.router.broadcastEvent('downloads.onChanged', dl.id, delta)
      })

      item.once('done', (ev, state) => {
        const delta = updateState(state)
        console.log('* download done', delta)
        const endTime = new Date().toISOString()
        delta.endTime = { previous: dl.endTime, current: endTime }
        dl.endTime = endTime
        this.ctx.router.broadcastEvent('downloads.onChanged', dl.id, delta)
      })

      this.downloads.push(new Download(dl, item))
      this.ctx.router.broadcastEvent('downloads.onCreated', dl)
      console.log(
        '* all downloads:',
        this.downloads.map((d) => d.download),
      )
    })
  }

  private convertDownloadState(
    state: 'progressing' | 'completed' | 'cancelled' | 'interrupted',
  ): chrome.downloads.DownloadState {
    switch (state) {
      case 'progressing':
        return 'in_progress'
      case 'completed':
        return 'complete'
      case 'cancelled':
        return 'interrupted'
      case 'interrupted':
        return 'interrupted'
      default:
        throw new Error(`Unknown download state ${state}`)
    }
  }

  private getDownload(id: number): { idx: number; dl: Download | undefined } {
    const idx = this.downloads.findIndex((d) => d.download.id === id)
    if (idx == -1) return { idx: -1, dl: undefined }
    const dl = this.downloads[idx]
    return { idx, dl }
  }

  private cancel(event: ExtensionEvent, downloadId: number) {
    const { dl } = this.getDownload(downloadId)
    if (dl?.sessDownload.getState() != 'progressing') return
    dl.sessDownload.cancel()
    dl.download.canResume = false
    dl.download.endTime = new Date().toISOString()
    dl.download.state = 'interrupted'
  }

  private download(event: ExtensionEvent, options: chrome.downloads.DownloadOptions) {
    this.pending.push(options)
    const opts: DownloadURLOptions = {}
    if (options.headers) {
      opts.headers = {}
      for (const header of options.headers) opts.headers[header.name] = header.value
    }
    event.sender.session.downloadURL(options.url, opts)
  }

  private erase(event: ExtensionEvent, downloadId: number) {
    const { idx, dl } = this.getDownload(downloadId)
    if (!dl) return
    if (dl.sessDownload.getState() == 'progressing') dl.sessDownload.cancel()
    this.downloads.splice(idx, 1)
    this.ctx.router.broadcastEvent('downloads.onErased', dl.download.id)
  }

  private pause(event: ExtensionEvent, downloadId: number) {
    const { idx, dl } = this.getDownload(downloadId)
    if (dl?.sessDownload.getState() != 'progressing' || dl?.sessDownload.isPaused()) return
    dl.sessDownload.pause()
  }

  private search(
    event: ExtensionEvent,
    query: chrome.downloads.DownloadQuery,
  ): chrome.downloads.DownloadItem[] {
    return this.downloads.map((d) => d.download)
  }

  private resume(event: ExtensionEvent, downloadId: number) {
    const { idx, dl } = this.getDownload(downloadId)
    if (dl?.sessDownload.getState() != 'progressing' || !dl?.sessDownload.isPaused()) return
    dl.sessDownload.resume()
  }
}

import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import { getAllWindows, matchesPattern, matchesTitlePattern, TabContents } from './common'
import { WindowsAPI } from './windows'
import { download } from 'electron-dl'
import { app, BrowserWindow, dialog, shell, DownloadItem, DownloadURLOptions } from 'electron'
import path from 'path'
import debug from 'debug'

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
    handle('downloads.open', this.open.bind(this))
    handle('downloads.pause', this.pause.bind(this))
    handle('downloads.removeFile', this.removeFile.bind(this))
    handle('downloads.resume', this.resume.bind(this))
    handle('downloads.search', this.search.bind(this))
    handle('downloads.setShelfEnabled', this.setShelfEnabled.bind(this))
    //handle('downloads.setUiOptions', this.setUiOptions.bind(this))
    handle('downloads.show', this.show.bind(this))
    handle('downloads.showDefaultFolder', this.showDefaultFolder.bind(this))
    this.ctx.session.on('will-download', (ev, item, wc) => {
      console.log('>> attempted to download', item.getURL())

      const mime = item.getMimeType()
      const urlChain = item.getURLChain()
      // if started from the downloads API, apply options
      const idx = this.pending.findIndex((p) => p.url == item.getURL())
      if (idx > -1) {
        const pend = this.pending.splice(idx, 1)[0]
        if (pend.filename) {
          console.log('Requester suggested filename', pend.filename)
          const relPath = pend.filename.split(/\\|\//).join(path.sep)
          const absPath = app.getPath('downloads') + path.sep + relPath
          console.log('Requester suggested filename', pend.filename)
          console.log('Suggested filename expanded to', absPath)
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
        const canResume = item.canResume()
        if (dl.canResume != canResume) {
          delta.canResume = { previous: dl.canResume, current: canResume }
          dl.canResume = canResume
        }
        const filename = item.getFilename()
        if (dl.filename != filename) {
          if (!dl.filename) {
            delta.filename = { previous: dl.filename, current: filename }
            dl.filename = filename
          } else item.setSavePath(dl.filename) // don't allow it to make up its own mind
        }
        const mime = item.getMimeType()
        if (dl.mime != mime) {
          delta.mime = { previous: dl.mime, current: mime }
          dl.mime = mime
        }
        const paused = item.isPaused()
        if (dl.paused != paused) {
          delta.paused = { previous: dl.paused, current: paused }
          dl.paused = paused
        }
        const newState = this.convertDownloadState(state)
        if (dl.state != newState) {
          delta.state = { previous: dl.state, current: newState }
          dl.state = newState
        }
        const totalBytes = item.getTotalBytes()
        if (dl.totalBytes != totalBytes) {
          delta.totalBytes = { previous: dl.totalBytes, current: totalBytes }
          dl.totalBytes = totalBytes
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

  private isSet(value: any): boolean {
    return typeof value !== 'undefined'
  }

  private filterDownloads(
    downloadItem: chrome.downloads.DownloadItem,
    downloadQuery: chrome.downloads.DownloadQuery,
  ) {
    const d = downloadItem
    const q = downloadQuery
    if (!d) return false
    if (!Object.keys(q).length) return true // no query criteria
    if (this.isSet(q.id) && q.id !== d.id) return false
    if (this.isSet(q.bytesReceived) && q.bytesReceived !== d.bytesReceived) return false
    if (this.isSet(q.danger) && q.danger !== d.danger) return false
    if (this.isSet(q.endTime) && q.endTime !== d.endTime) return false
    if (this.isSet(q.endedAfter) && (!d.endTime || new Date(q.endedAfter!) >= new Date(d.endTime)))
      return false
    if (
      this.isSet(q.endedBefore) &&
      (!d.endTime || new Date(q.endedBefore!) <= new Date(d.endTime))
    )
      return false
    if (this.isSet(q.error) && q.error !== d.error) return false
    if (this.isSet(q.exists) && q.exists !== d.exists) return false
    if (this.isSet(q.fileSize) && q.fileSize !== d.fileSize) return false
    if (this.isSet(q.filename) && q.filename !== d.filename) return false
    if (this.isSet(q.filenameRegex) && !new RegExp(q.filenameRegex!).test(d.filename)) return false
    // finalUrl doesn't exist?
    if (this.isSet(q.mime) && q.mime !== d.mime) return false
    if (this.isSet(q.paused) && q.paused !== d.paused) return false
    if (this.isSet(q.startTime) && q.startTime !== d.startTime) return false
    if (
      this.isSet(q.startedAfter) &&
      (!d.startTime || new Date(q.startedAfter!) >= new Date(d.startTime))
    )
      return false
    if (
      this.isSet(q.startedBefore) &&
      (!d.startTime || new Date(q.startedBefore!) <= new Date(d.startTime))
    )
      return false
    if (this.isSet(q.state) && q.state !== d.state) return false
    if (this.isSet(q.totalBytes) && q.totalBytes !== d.totalBytes) return false
    if (this.isSet(q.totalBytesGreater) && q.totalBytesGreater! >= d.totalBytes) return false
    if (this.isSet(q.totalBytesLess) && q.totalBytesLess! <= d.totalBytes) return false
    if (this.isSet(q.url) && q.url !== d.url) return false
    if (this.isSet(q.urlRegex) && !new RegExp(q.urlRegex!).test(d.url)) return false
    // TODO: query.query
    return true
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

  private erase(event: ExtensionEvent, query: chrome.downloads.DownloadQuery) {
    const downloads = this.downloads.filter((d) => this.filterDownloads(d.download, query))
    for (const dl of downloads) {
      if (dl.sessDownload.getState() == 'progressing') dl.sessDownload.cancel()
      const idx = this.downloads.findIndex((d) => d.download.id === dl.download.id)
      this.downloads.splice(idx, 1)
      this.ctx.router.broadcastEvent('downloads.onErased', dl.download.id)
    }
  }

  private async open(event: ExtensionEvent, downloadId: number) {
    const { idx, dl } = this.getDownload(downloadId)
    if (dl?.download.state != 'complete') return
    await shell.openPath(dl.sessDownload.getSavePath())
  }

  private pause(event: ExtensionEvent, downloadId: number) {
    const { idx, dl } = this.getDownload(downloadId)
    if (dl?.sessDownload.getState() != 'progressing' || dl?.sessDownload.isPaused()) return
    dl.sessDownload.pause()
  }

  private removeFile(event: ExtensionEvent, downloadId: number) {
    const { idx, dl } = this.getDownload(downloadId)
    if (dl?.download.state != 'complete') return
    shell.trashItem(dl.sessDownload.getSavePath())
  }

  private resume(event: ExtensionEvent, downloadId: number) {
    const { idx, dl } = this.getDownload(downloadId)
    if (dl?.sessDownload.getState() != 'progressing' || !dl?.sessDownload.isPaused()) return
    dl.sessDownload.resume()
  }

  private search(
    event: ExtensionEvent,
    query: chrome.downloads.DownloadQuery,
  ): chrome.downloads.DownloadItem[] {
    return this.downloads
      .map((d) => d.download)
      .filter((d) => this.filterDownloads(d, query))
      .slice(0, this.isSet(query.limit) && query.limit! > 0 ? query.limit : undefined)
    // TODO: query.orderBy
  }

  private setShelfEnabled(event: ExtensionEvent, enabled: boolean) {
    // Nothing to do
  }

  private show(event: ExtensionEvent, downloadId: number) {
    const { idx, dl } = this.getDownload(downloadId)
    console.log('* show in folder: ', dl?.download)
    if (dl?.download.state != 'complete') return
    shell.showItemInFolder(dl.sessDownload.getSavePath())
  }

  private showDefaultFolder(event: ExtensionEvent) {
    shell.openPath(app.getPath('downloads'))
  }
}

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
    const isSet = (value: any) => typeof value !== 'undefined'

    return this.downloads
      .map((d) => d.download)
      .filter((d) => {
        if (!d) return false
        if (!Object.keys(query).length) return true // no query criteria
        if (isSet(query.id) && query.id !== d.id) return false
        if (isSet(query.bytesReceived) && query.bytesReceived !== d.bytesReceived) return false
        if (isSet(query.danger) && query.danger !== d.danger) return false
        if (isSet(query.endTime) && query.endTime !== d.endTime) return false
        if (
          isSet(query.endedAfter) &&
          (!d.endTime || new Date(query.endedAfter!) >= new Date(d.endTime))
        )
          return false
        if (
          isSet(query.endedBefore) &&
          (!d.endTime || new Date(query.endedBefore!) <= new Date(d.endTime))
        )
          return false
        if (isSet(query.error) && query.error !== d.error) return false
        if (isSet(query.exists) && query.exists !== d.exists) return false
        if (isSet(query.fileSize) && query.fileSize !== d.fileSize) return false
        if (isSet(query.filename) && query.filename !== d.filename) return false
        if (isSet(query.filenameRegex) && !new RegExp(query.filenameRegex!).test(d.filename))
          return false
        // finalUrl doesn't exist?
        if (isSet(query.mime) && query.mime !== d.mime) return false
        if (isSet(query.paused) && query.paused !== d.paused) return false
        if (isSet(query.startTime) && query.startTime !== d.startTime) return false
        if (
          isSet(query.startedAfter) &&
          (!d.startTime || new Date(query.startedAfter!) >= new Date(d.startTime))
        )
          return false
        if (
          isSet(query.startedBefore) &&
          (!d.startTime || new Date(query.startedBefore!) <= new Date(d.startTime))
        )
          return false
        if (isSet(query.state) && query.state !== d.state) return false
        if (isSet(query.totalBytes) && query.totalBytes !== d.totalBytes) return false
        if (isSet(query.totalBytesGreater) && query.totalBytesGreater! >= d.totalBytes) return false
        if (isSet(query.totalBytesLess) && query.totalBytesLess! <= d.totalBytes) return false
        if (isSet(query.url) && query.url !== d.url) return false
        if (isSet(query.urlRegex) && !new RegExp(query.urlRegex!).test(d.url)) return false
        // TODO: query.query
        return true
      })
      .slice(0, isSet(query.limit) && query.limit! > 0 ? query.limit : undefined)
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

import path from 'node:path'
import fs from 'fs'
const fsAsync = fs.promises
import { Readable } from 'stream'
import { finished } from 'stream/promises'
import AdmZip from 'adm-zip'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'

let self

class ProcessTracker {
  name
  processStarted // (process)
  processProgress // (process, stage, current, total)
  processCompleted // (process)

  constructor(name, options) {
    this.name = name
    this.processStarted = options.processStarted
    this.processProgress = options.processProgress
    this.processCompleted = options.processCompleted
    if (this.processStarted) this.processStarted(name)
  }

  progress(ev) {
    if (this.processProgress) this.processProgress(this.name, ev.phase, ev.loaded, ev.total)
  }

  complete() {
    if (this.processCompleted) this.processCompleted(this.name)
  }
}

class KC3Updater {
  processOpts

  constructor(options) {
    this.processOpts = {
      processStarted: options.onProcessStarted,
      processProgress: options.onProcessProgress,
      processCompleted: options.onProcessCompleted,
    }
    self = this
  }

  newProcess(name) {
    return new ProcessTracker(name, self.processOpts)
  }

  async update(extensionsPath, channel) {
    if (!fs.existsSync(extensionsPath)) {
      try {
        fs.mkdirSync(extensionsPath)
      } catch (err) {}
    }

    const dir = path.join(extensionsPath, 'kc3kai-' + channel)

    console.log(`kc3updater.js: kc3 location ${dir} channel ${channel}`)

    if (!['release', 'master', 'develop'].includes(channel) && !channel.startsWith('custom'))
      throw new Error(`kc3updater.js: Invalid update channel ${channel}`)

    let updateProcess = self.newProcess('KC3 Update')
    try {
      if (channel.startsWith('custom')) {
        console.log('kc3updater.js: Using custom update channel; skipping update check.')
        return
      } else if (channel == 'release') {
        const updateCheckProcess = self.newProcess('Checking for updates')
        const releaseData = await (
          await fetch('http://api.github.com/repos/kc3kai/kc3kai/releases/latest')
        ).json()
        const latestVersion = releaseData.name
        updateCheckProcess.complete()

        const releaseAsset = releaseData.assets.filter((a) =>
          /^kc3kai-[\d.]+\.zip$/.test(a.name),
        )[0]

        const releaseFile = path.join(dir, 'release')

        let localVersion
        try {
          localVersion = fs.readFileSync(releaseFile)
        } catch (err) {
          /* doesn't exist */
        }

        console.log(`kc3updater.js: Current: ${localVersion}; latest: ${latestVersion}`)
        if (localVersion == latestVersion) {
          console.log('kc3updater.js: Already up to date.')
        } else {
          const zipProcess = self.newProcess('Downloading release ' + latestVersion)
          try {
            if (fs.existsSync(dir)) {
              try {
                fs.rmdirSync(dir, { recursive: true, force: true })
              } catch (err) {}
            }
            try {
              fs.mkdirSync(dir)
            } catch (err) {}
            const zipRes = await fetch(releaseAsset.browser_download_url)
            const zipFilename = 'kc3kai-release-' + latestVersion + '.zip'
            const zipFilePath = path.join(dir, zipFilename)
            const stream = fs.createWriteStream(zipFilePath, { flags: 'wx' })
            await finished(Readable.fromWeb(zipRes.body).pipe(stream))

            var zip = new AdmZip(zipFilePath)
            zip.extractAllTo(dir, true)

            try {
              fs.rmSync(zipFilePath)
            } catch (err) {}
            fs.writeFileSync(releaseFile, latestVersion)
          } finally {
            zipProcess.complete()
          }
        }
      } else {
        const updatePhases = 8
        let updatePhase = 0
        const updateProgress = () => {
          updateProcess.progress({ phase: '', loaded: ++updatePhase, total: updatePhases })
        }
        updateProgress()

        if (!fs.existsSync(dir) || !fs.existsSync(path.join(dir, 'package.json'))) {
          console.log('Cloning repo...')

          const kc3CloneProcess = self.newProcess('Cloning repo')
          await git.clone({
            fs,
            http,
            dir,
            onProgress: kc3CloneProcess.progress.bind(kc3CloneProcess),
            url: 'https://github.com/kc3kai/kc3kai',
          })
          await git.checkout({ fs, http, dir, ref: 'develop' })
          kc3CloneProcess.complete()
        } else console.log('Updating existing repo...')

        updateProgress()

        console.log('Checking kc3-translations...')
        const langPath = 'src/data/lang'
        let langOk = fs.existsSync(path.join(dir, langPath, '.git'))

        updateProgress()

        // Get current commit
        let currentCommit = (await git.log({ fs, dir, depth: 1 }))[0]
        // Get current lang commit
        let currentLangCommit
        if (langOk)
          currentLangCommit = (await git.log({ fs, dir, filepath: langPath, depth: 1 }))[0]

        updateProgress()

        // Fetch new commit info
        console.log('Updating repo info...')
        const kc3FetchProcess = self.newProcess('Checking for new commits')
        let result = await git.fetch({
          fs,
          http,
          dir,
          onProgress: kc3FetchProcess.progress.bind(kc3FetchProcess),
        })
        kc3FetchProcess.complete()

        updateProgress()

        // Update branch list
        console.log('Fetching branch list...')
        let branches = await git.listBranches({ fs, dir, remote: 'origin' })

        updateProgress()

        // Get newest commit
        let latestCommit = (await git.log({ fs, dir, depth: 1 }))[0]

        if (currentCommit.oid != latestCommit.oid || !langOk) {
          console.log('Pulling KC3Kai...')
          // Pull from remote
          const kc3PullProcess = self.newProcess('Pulling latest commits')
          await git.fastForward({
            fs,
            http,
            dir,
            onProgress: kc3PullProcess.progress.bind(kc3PullProcess),
            url: 'https://github.com/kc3kai/kc3kai',
          })
          kc3PullProcess.complete()

          updateProgress()

          // Get the last commit involving lang submodule dir
          console.log('Checking kc3-translations location...')
          let latestLangCommits = await git.log({
            fs,
            dir,
            filepath: langPath,
            depth: 1,
          })

          updateProgress()

          console.log(`Commits: ${latestLangCommits?.length}`)
          let latestLangCommit = latestLangCommits[0]

          console.log(`current lang: ${currentLangCommit?.oid ?? '[none]'}`)
          console.log(`latest lang: ${latestLangCommit.oid}`)
          console.log(`lang dir OK: ${langOk}`)
          if (currentLangCommit?.oid != latestLangCommit.oid || !langOk) {
            console.log('Locating kc3-translations commit...')
            // get list of modified files
            let tree = await git.readTree({
              fs,
              dir,
              oid: latestLangCommit.commit.tree,
              filepath: 'src/data',
            })
            let tlOid = tree.tree.find((t) => t.path === 'lang').oid

            const langDir = path.join(dir, langPath)
            await fsAsync.rm(langDir, { recursive: true, force: true })

            console.log('Pulling kc3-translations...')
            const tlPullProcess = self.newProcess('Updating translation repo')
            await git.clone({
              fs,
              http,
              dir: langDir,
              onProgress: tlPullProcess.progress.bind(tlPullProcess),
              url: 'https://github.com/kc3kai/kc3-translations',
              ref: tlOid,
            })
            tlPullProcess.complete()
          } // pull lang
        } // pull kc3kai
      }
    } finally {
      updateProcess.complete()
    }

    console.log('Done.')
  }
}

export default KC3Updater

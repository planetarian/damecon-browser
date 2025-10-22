import path from 'node:path'
import fs from 'fs'
const fsAsync = fs.promises
import { Readable } from 'stream'
import { finished } from 'stream/promises'
import AdmZip from 'adm-zip'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import ProcessTracker from './processtracker'
import { onUpdateStarted, onUpdateProgress, onUpdateCompleted } from './updater-utils.js'

let self

class KC3Updater {
  processOpts = {
    processStarted: onUpdateStarted,
    processProgress: onUpdateProgress,
    processCompleted: onUpdateCompleted,
  }

  constructor(options) {
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
    const langPath = 'src/data/lang'
    const langDir = path.join(dir, langPath)

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
          await fetch('https://api.github.com/repos/kc3kai/kc3kai/releases/latest')
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
        const updatePhases = 5
        let updatePhase = 0
        const updateProgress = () => {
          updateProcess.progress({ phase: '', loaded: updatePhase++, total: updatePhases })
        }
        updateProgress()

        if (!fs.existsSync(dir) || !fs.existsSync(path.join(dir, 'package.json'))) {
          console.log('Cloning repo...')

          const kc3CloneProcess = self.newProcess('Cloning repo')
          await git.clone({
            fs,
            http,
            dir,
            url: 'https://github.com/kc3kai/kc3kai',
            ref: channel,
            onProgress: kc3CloneProcess.progress.bind(kc3CloneProcess)
          })
          kc3CloneProcess.complete()
        } else console.log('Updating existing repo...')

        updateProgress()

        console.log('Checking kc3-translations...')
        let langOk = fs.existsSync(path.join(dir, langPath, '.git'))

        // Get current commit
        let currentCommit = (await git.log({ fs, dir, depth: 1 }))[0]
        // Get current lang commit
        let currentLangCommit
        if (langOk)
          currentLangCommit = (await git.log({ fs, dir: langDir, depth: 1 }))[0]

        // Get newest commit
        let latestCommits = await git.listServerRefs({
          http,
          url: 'https://github.com/kc3kai/kc3kai',
          prefix: `refs/heads/${channel}`
          })
        let latestCommit = latestCommits[0]

        console.log(`current kc3: ${currentCommit.oid}`)
        console.log(`latest kc3: ${latestCommit.oid}`)

        updateProgress()

        let IsKc3UpToDate = currentCommit.oid == latestCommit.oid

        if (!IsKc3UpToDate || !langOk) {
          if (!IsKc3UpToDate) {
            // Fetch new commit info
            console.log('Updating repo info...')
            const kc3FetchProcess = self.newProcess('Checking for new commits')
            await git.fetch({
              fs,
              http,
              dir,
              singleBranch: true,
              ref: latestCommit.oid,
              onProgress: kc3FetchProcess.progress.bind(kc3FetchProcess)
            })
            kc3FetchProcess.complete()

            console.log('Pulling KC3Kai...')
            // Pull from remote
            const kc3PullProcess = self.newProcess('Pulling latest commits')
            await git.checkout({
              fs,
              dir,
              force: true,
              ref: latestCommit.oid,
              onProgress: kc3PullProcess.progress.bind(kc3PullProcess)
            })
            kc3PullProcess.complete()
          }

          updateProgress()

          // Get the last commit involving lang submodule dir
          console.log('Checking kc3-translations location...')
          let latestSubmoduleCommits = await git.log({
            fs,
            dir,
            filepath: langPath,
            depth: 1
          })
          let latestSubmoduleCommit = latestSubmoduleCommits[0]

          let tree = await git.readTree({
            fs,
            dir,
            oid: latestSubmoduleCommit.commit.tree,
            filepath: 'src/data'
          })
          let latestLangCommit = tree.tree.find((t) => t.path === 'lang')

          console.log(`current lang: ${currentLangCommit?.oid ?? '[none]'}`)
          console.log(`latest lang: ${latestLangCommit.oid}`)
          console.log(`lang dir OK: ${langOk}`)

          updateProgress()

          if (currentLangCommit?.oid != latestLangCommit.oid || !langOk) {
            if (!langOk) {
              console.log('Cloning kc3-translations...')
              const tlPullProcess = self.newProcess('Cloning translation repo')
              await git.clone({
                fs,
                http,
                dir: langDir,
                url: 'https://github.com/kc3kai/kc3-translations',
                ref: latestLangCommit.oid,
                onProgress: tlPullProcess.progress.bind(tlPullProcess)
              })
              tlPullProcess.complete()
            } else {
              // Fetch new commit info
              const tlFetchProcess = self.newProcess('Fetching new translation commits')
              await git.fetch({
                fs,
                http,
                dir: langDir,
                singleBranch: true,
                ref: latestLangCommit.oid,
                onProgress: tlFetchProcess.progress.bind(tlFetchProcess)
              })
              tlFetchProcess.complete()

              console.log('Pulling kc3-translations...')
              const tlPullProcess = self.newProcess('Updating translation repo')
              await git.checkout({
                fs,
                dir: langDir,
                force: true,
                ref: latestLangCommit.oid,
                onProgress: tlPullProcess.progress.bind(tlPullProcess)
                })
              tlPullProcess.complete()
            }
            updateProgress()
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

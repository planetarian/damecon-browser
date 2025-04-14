// https://github.com/bakabird/electron-forge-webpack-typescript-worker/blob/master/README_en.md

const { Worker: NodeJSWorker } = require('worker_threads')
const { resolve: resolvePath } = require('path')

global.Worker = function NodeJSWorkerThreadsPathResolveWrap(path, options) {
  // this __dirname will travel into the bundle and only resolved at
  // runtime there, so it will be the path to the dist bin
  // and we can assume to find the worker there.
  // generally, this has to be an absolute path with NodeJS worker-threads,
  // so this is why we use resolve here and not join.
  console.log(
    'WorkerShim.js: path: ' +
      path +
      ' options: ' +
      options +
      'resolvedPath ' +
      resolvePath(__dirname, path),
  )
  return new NodeJSWorker(resolvePath(__dirname, path), options)
}

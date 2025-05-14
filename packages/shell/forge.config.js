const path = require('path')
const fs = require('fs/promises')

module.exports = {
  packagerConfig: {
    name: 'damecon-browser',
    asar: true,
    extraResource: ['browser/ui'],
    icon: 'icon',
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32'],
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: (arch) => ({
        remoteReleases: `https://tsunkit.net/damecon-browser/updates/win32/${arch}`,
        setupIcon: 'icon.ico',
        authors: 'TsunKit',
      }),
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.config.js',
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              name: 'browser',
              preload: {
                js: './preload.ts',
              },
            },
          ],
        },
        devServer: {
          client: {
            overlay: false,
          },
        },
      },
    },
  ].filter(Boolean),
  hooks: {
    postPackage: async (config, options) => {
      try {
        var src = path.join(__dirname, '../../extensions')
        var dst = path.join(options.outputPaths[0], 'extensions')
        try {
          await fs.mkdir(dst)
        } catch {}
        const directories = (await fs.readdir(src, { withFileTypes: true }))
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
        for (const dir of directories) {
          var regex = /^(?!kc3kai).*$/
          if (regex.test(dir)) {
            await fs.cp(path.join(src, dir), path.join(dst, dir), { recursive: true })
          }
        }
        const minCacheSrc = path.join(__dirname, '../../packages/kccacheproxy/minimum-cache.zip')
        const minCacheDest = path.join(options.outputPaths[0], 'resources/minimum-cache.zip')
        const fi = await fs.stat(minCacheSrc)
        if (!fi.isFile())
          throw new Error(
            'Minimum cache zip not found. run in packages/kccacheproxy/build.bat to generate it.',
          )
        await fs.copyFile(minCacheSrc, minCacheDest)
      } catch (error) {
        console.log('Error copying extensions', error)
      }
    },
  },
}

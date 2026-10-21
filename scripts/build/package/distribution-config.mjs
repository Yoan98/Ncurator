import path from 'node:path'
import { assertDistribution, distributionName } from '../../release/shared/distribution.mjs'

export const createDistributionConfig = (base, { distribution, output, resourcesDirectory }) => {
  assertDistribution(distribution)
  const name = distributionName(distribution)
  const origin =
    distribution === 'international'
      ? 'https://download.ncurator.com'
      : 'https://download.guanzhangai.cn'
  return {
    ...base,
    productName: name,
    directories: { ...base.directories, output },
    extraResources: [
      ...base.extraResources.filter((item) => item.to !== 'app-update.yml'),
      { from: path.join(resourcesDirectory, 'app-update.yml'), to: 'app-update.yml' },
      { from: path.join(resourcesDirectory, 'app-distribution.json'), to: 'app-distribution.json' }
    ],
    win: { ...base.win, executableName: name },
    nsis: {
      ...base.nsis,
      artifactName: `${name}-\${version}-Windows-\${arch}.\${ext}`,
      shortcutName: name,
      uninstallDisplayName: name,
      language: distribution === 'international' ? '1033' : '2052',
      installerLanguages: distribution === 'international' ? ['en_US'] : ['zh_CN']
    },
    publish: { provider: 'generic', url: `${origin}/updates/latest` }
  }
}

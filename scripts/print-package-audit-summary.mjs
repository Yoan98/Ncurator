/* eslint-disable @typescript-eslint/explicit-function-return-type */
import fs from 'node:fs'
import path from 'node:path'

const reportPath = path.resolve(process.argv[2] || 'dist/package-audit.json')
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const formatSize = (bytes) => `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MiB`

process.stdout.write('## Package security audit\n\n')
process.stdout.write(`Platform: ${report.platform}-${report.arch}\n\n`)
process.stdout.write('| Type | Name | Size |\n| --- | --- | ---: |\n')
for (const application of report.applications || []) {
  process.stdout.write(
    `| Installed app | ${application.root} | ${formatSize(application.totalBytes)} |\n`
  )
  process.stdout.write(
    `| app.asar | ${application.archive} | ${formatSize(application.archiveBytes)} |\n`
  )
}
for (const installer of report.installers || []) {
  process.stdout.write(
    `| Installer/update | ${installer.name} | ${formatSize(installer.bytes)} |\n`
  )
}
process.stdout.write('\nThe source, secret and forbidden-file audit passed.\n')
if (!report.sizeBudget || report.sizeBudget.status === 'not-configured') {
  process.stdout.write('Numeric size budgets are not configured for this platform.\n')
} else {
  process.stdout.write(`\n## Package size budget: ${report.sizeBudget.status}\n\n`)
  process.stdout.write('| Item | Current | Baseline | Growth | Hard limit | Status |\n')
  process.stdout.write('| --- | ---: | ---: | ---: | ---: | --- |\n')
  for (const metric of report.sizeBudget.metrics || []) {
    process.stdout.write(
      `| ${metric.label} | ${formatSize(metric.actualBytes)} | ${formatSize(metric.baselineBytes)} | ` +
        `${Number(metric.growthPercent).toFixed(1)}% | ${formatSize(metric.hardLimitBytes)} | ${metric.status} |\n`
    )
  }
}

// Gateway Unit tests provide synthetic credentials independently of private developer files.
// File selection and inherited-key isolation are exercised with real files in service-environment.test.ts.
export const readDesktopServiceEnvironment = () => ({
  environment: 'production' as const,
  api: 'https://api.guanzhangai.cn',
  web: 'https://www.guanzhangai.cn',
  appKey: process.env.NCURATOR_APP_SECRET_DESKTOP ?? ''
})

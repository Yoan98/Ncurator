/**
 * 启动加载画面：由 index.html 内联渲染，首帧即可见，不依赖 React 挂载。
 * 首次会话就绪后调用这里淡出并移除；幂等，重复调用无副作用。
 */

const BOOT_SPLASH_ID = 'nc-boot-splash'
const FADE_OUT_MS = 220

export const dismissBootSplash = (): void => {
  const splash = document.getElementById(BOOT_SPLASH_ID)
  if (!splash) return
  document.documentElement.dataset.ncBoot = 'done'
  if (splash.classList.contains('nc-boot-leaving')) return
  splash.classList.add('nc-boot-leaving')
  window.setTimeout(() => splash.remove(), FADE_OUT_MS)
}

// Univer publishes CommonJS Node entry points with the same API as its typed root exports.
declare module '@univerjs/core/lib/cjs/index.js' {
  const api: typeof import('@univerjs/core')
  export default api
}
declare module '@univerjs/core/lib/cjs/facade.js' {
  const api: typeof import('@univerjs/core/facade')
  export default api
}
declare module '@univerjs/engine-formula/lib/cjs/index.js' {
  const api: typeof import('@univerjs/engine-formula')
  export default api
}
declare module '@univerjs/sheets/lib/cjs/index.js' {
  const api: typeof import('@univerjs/sheets')
  export default api
}
declare module '@univerjs/sheets-formula/lib/cjs/index.js' {
  const api: typeof import('@univerjs/sheets-formula')
  export default api
}

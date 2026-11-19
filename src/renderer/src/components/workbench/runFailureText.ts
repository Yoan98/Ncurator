// Older persisted events may still carry the previous billing suffix or titles.
export const presentRunFailureText = (value?: string): string =>
  (value ?? '')
    .replace(/本次(?:未|已)计费[。.]?|计费状态待确认[。.]?/gu, '')
    .replace(/上一笔费用仍在处理，请稍后再试。/gu, '上一条请求仍在处理，请稍后再试。')
    .replace(/本次费用仍在处理。/gu, '这次请求仍在处理，请稍后再试。')
    .replace(/馆长账户有未付费用，请充值后再试。/gu, '请充值后再试。')
    .replace(/费用处理中/gu, '请求处理中')
    .replace(/账户有待付费用/gu, '需要充值')
    .trim()

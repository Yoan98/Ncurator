
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const fetchWithRetry = async (url, options = {}, retryOptions = {}) => {
  const attempts = Number(retryOptions.attempts || 5)
  const delayMs = Number(retryOptions.delayMs || 2_000)
  let lastError
  let lastResponse

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options)
      lastResponse = response
      if (response.ok || response.status < 500 || attempt === attempts) return response
    } catch (error) {
      lastError = error
      if (attempt === attempts) throw error
    }
    await delay(delayMs * attempt)
  }

  if (lastResponse) return lastResponse
  throw lastError || new Error(`request failed: ${url}`)
}

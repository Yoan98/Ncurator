export const countLines = (text: string): number => {
  let count = 1
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1
  }
  return count
}

export const buildLineNumbers = (lineCount: number): string => {
  let result = ''
  for (let i = 1; i <= lineCount; i += 1) {
    result += `${i}\n`
  }
  return result
}

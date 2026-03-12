const REACT_19_REF_WARNING = 'Accessing element.ref was removed in React 19.'

export const shouldSuppressRendererConsoleNoise = (
  args: Array<string | number | boolean | null | undefined | object>
): boolean => {
  const text = args.map((item) => String(item)).join(' ')
  return text.includes(REACT_19_REF_WARNING)
}

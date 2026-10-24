import { t } from '../../i18n'
import { normalizeUserFacingError } from '../../utils/userFacingError'

export const skillError = (error: unknown): string => {
  const text = String(error)
  if (text.includes('A skill with this name already exists'))
    return t(($) => $.userSkills.nameConflict)
  if (text.includes('Skill name must be')) return t(($) => $.userSkills.invalidName)
  if (text.includes('Skill description must be')) return t(($) => $.userSkills.invalidDescription)
  if (text.includes('Skill instructions cannot be empty')) return t(($) => $.userSkills.emptyBody)
  const affected = /Skill instructions exceed 64 KiB for: (.+)/.exec(text)
  if (affected) return t(($) => $.userSkills.affectedPartners, { names: affected[1] })
  if (text.includes('Skill instructions exceed 64 KiB')) return t(($) => $.userSkills.overBudget)
  if (text.includes('Skill import expired') || text.includes('Skill changed during import'))
    return t(($) => $.userSkills.importExpired)
  return normalizeUserFacingError(error)
}

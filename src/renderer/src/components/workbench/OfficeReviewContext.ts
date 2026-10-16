import { createContext, useContext } from 'react'
import type { OfficeReviewIndex } from '../../../../shared/fileReview'
export const OfficeReviewContext = createContext<{
  index: OfficeReviewIndex
  enabled: boolean
  navigate: (id: string) => void
} | null>(null)
export const useOfficeReviewNavigation = () => useContext(OfficeReviewContext)

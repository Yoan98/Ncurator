import { t } from '../../i18n'
import FileIcon from '../FileIcon'
import { Button, Spin } from 'antd'
import { HiArrowRight } from 'react-icons/hi2'
import { workbenchSelectors } from '../../testing/selectors'
import type { WorkspaceLoadState } from './types'

type WorkspaceFilesEmptyStateProps = {
  loadState: WorkspaceLoadState
  onOpenSettings: () => void
  onRetry: () => void
}

const WorkspaceFilesEmptyState = ({
  loadState,
  onOpenSettings,
  onRetry
}: WorkspaceFilesEmptyStateProps): React.JSX.Element => (
  <div
    className="flex h-full w-full items-center justify-center px-6 py-8 text-center"
    data-testid={workbenchSelectors.workspaceFilesEmptyState}
  >
    {loadState === 'loading' ? (
      <div role="status" className="flex items-center gap-2 text-[13px] text-[#91918E]">
        <Spin size="small" />
        {t(($) => $.workbench.loadingDirectories)}
      </div>
    ) : (
      <div className="w-full max-w-[320px]">
        <FileIcon kind="directory" className="mx-auto h-8 w-8 text-[#91918E]" />
        <div className="mt-4 text-[16px] font-semibold text-[#37352F]">
          {loadState === 'error'
            ? t(($) => $.workbench.couldNotLoadDirectories)
            : t(($) => $.workbench.noDirectoriesAddedYet)}
        </div>
        <div className="mt-2 text-[13px] leading-5 text-[#91918E]">
          {loadState === 'error'
            ? t(($) => $.workbench.reloadTheDirectoriesToTryAgain)
            : t(($) => $.workbench.addADirectoryInWorkspaceSettingsToBrowseAnd)}
        </div>
        <Button
          type="primary"
          className="mt-5 inline-flex items-center gap-1.5 text-[13px]"
          onClick={loadState === 'error' ? onRetry : onOpenSettings}
        >
          {loadState === 'error'
            ? t(($) => $.workbench.reload)
            : t(($) => $.workbench.goToSettings)}
          {loadState === 'ready' ? <HiArrowRight className="h-3.5 w-3.5" /> : null}
        </Button>
      </div>
    )}
  </div>
)

export default WorkspaceFilesEmptyState

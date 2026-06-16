import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Progress, Space, Tag, message } from 'antd'
import { HiArrowPath, HiCheckCircle, HiExclamationTriangle, HiRocketLaunch } from 'react-icons/hi2'
import type { AppUpdateSnapshot, AppUpdateStatus } from '../../../../shared/types'

const STATUS_META: Record<AppUpdateStatus, { label: string; className: string }> = {
  idle: { label: '待检查', className: 'border-[#EEEEEC] text-[#787774]' },
  checking: { label: '检查中', className: 'border-[#B8C7D9] text-[#2F5D8C]' },
  available: { label: '发现新版本', className: 'border-[#B8C7D9] text-[#2F5D8C]' },
  downloading: { label: '下载中', className: 'border-[#D7C48C] text-[#8A6D1A]' },
  downloaded: { label: '等待安装', className: 'border-[#A7D4B5] text-[#2F7A45]' },
  'not-available': { label: '已是最新', className: 'border-[#A7D4B5] text-[#2F7A45]' },
  error: { label: '更新异常', className: 'border-[#E7B3AA] text-[#A33A2A]' }
}

const formatBytes = (bytes: number | undefined): string => {
  if (!bytes || bytes <= 0) return '-'
  const mb = bytes / 1024 / 1024
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
}

const getStatusText = (snapshot: AppUpdateSnapshot | null): string => {
  if (!snapshot) return '正在读取更新状态'
  if (!snapshot.updateSupported) {
    return snapshot.isPackaged ? '当前系统暂不支持自动更新' : '开发模式不会检查自动更新'
  }
  if (snapshot.status === 'downloaded') return '更新已下载，重启后完成安装'
  if (snapshot.status === 'downloading') return '正在下载更新包'
  if (snapshot.status === 'available') return '已发现新版本，正在准备下载'
  if (snapshot.status === 'not-available') return '当前已经是最新版本'
  if (snapshot.status === 'error') return snapshot.error || '检查更新失败'
  if (snapshot.status === 'checking') return '正在检查最新版本'
  return '可以手动检查是否有新版本'
}

const AppUpdateSettingsPanel: React.FC = () => {
  const [snapshot, setSnapshot] = useState<AppUpdateSnapshot | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    let mounted = true

    window.api
      .appUpdateGetSnapshot()
      .then((nextSnapshot) => {
        if (mounted) {
          setSnapshot(nextSnapshot)
        }
      })
      .catch((error) => {
        console.error('Failed to read app update snapshot', error)
      })

    const removeListener = window.api.onAppUpdateStatus((nextSnapshot) => {
      setSnapshot(nextSnapshot)
    })

    return () => {
      mounted = false
      removeListener()
    }
  }, [])

  const statusMeta = useMemo(() => STATUS_META[snapshot?.status || 'idle'], [snapshot?.status])
  const checkDisabled =
    !snapshot?.updateSupported ||
    snapshot.status === 'checking' ||
    snapshot.status === 'downloading'
  const installDisabled = snapshot?.status !== 'downloaded'
  const progressPercent = Math.round(snapshot?.progressPercent || 0)

  const handleCheck = async (): Promise<void> => {
    setChecking(true)
    try {
      const response = await window.api.appUpdateCheck()
      setSnapshot(response.snapshot)
      if (!response.success) {
        message.error(response.error || '检查更新失败')
      } else if (response.snapshot.status === 'not-available') {
        message.success('当前已经是最新版本')
      }
    } catch (error) {
      console.error('Failed to check updates', error)
      message.error('检查更新失败')
    } finally {
      setChecking(false)
    }
  }

  const handleInstall = async (): Promise<void> => {
    setInstalling(true)
    try {
      const response = await window.api.appUpdateInstall()
      if (!response.success) {
        setSnapshot(response.snapshot)
        message.error(response.error || '安装更新失败')
        setInstalling(false)
      }
    } catch (error) {
      console.error('Failed to install update', error)
      message.error('安装更新失败')
      setInstalling(false)
    }
  }

  return (
    <div className="h-full overflow-auto bg-white px-1 py-1">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="m-0 text-[18px] font-semibold text-[#37352F]">应用更新</h2>
            <div className="mt-1 text-[13px] text-[#787774]">
              当前版本 {snapshot?.currentVersion || '-'}
            </div>
          </div>
          <Tag className={`m-0 rounded-full border bg-white px-3 py-1 ${statusMeta.className}`}>
            {statusMeta.label}
          </Tag>
        </div>

        <Alert
          showIcon
          type={
            snapshot?.status === 'error'
              ? 'error'
              : snapshot?.status === 'downloaded'
                ? 'success'
                : 'info'
          }
          icon={
            snapshot?.status === 'error' ? (
              <HiExclamationTriangle />
            ) : snapshot?.status === 'downloaded' ? (
              <HiCheckCircle />
            ) : (
              <HiArrowPath />
            )
          }
          message={getStatusText(snapshot)}
        />

        {snapshot?.availableVersion ? (
          <div className="grid gap-3 text-[13px] text-[#2F3437] sm:grid-cols-2">
            <div>
              <div className="text-[#787774]">可用版本</div>
              <div className="mt-1 font-medium text-[#37352F]">{snapshot.availableVersion}</div>
            </div>
            <div>
              <div className="text-[#787774]">发布时间</div>
              <div className="mt-1 font-medium text-[#37352F]">{snapshot.releaseDate || '-'}</div>
            </div>
          </div>
        ) : null}

        {snapshot?.status === 'downloading' || snapshot?.status === 'downloaded' ? (
          <div>
            <Progress
              percent={progressPercent}
              status={snapshot.status === 'downloaded' ? 'success' : 'active'}
            />
            <div className="mt-1 text-[12px] text-[#787774]">
              {formatBytes(snapshot.transferredBytes)} / {formatBytes(snapshot.totalBytes)}
            </div>
          </div>
        ) : null}

        <Space wrap>
          <Button
            icon={<HiArrowPath />}
            loading={checking || snapshot?.status === 'checking'}
            disabled={checkDisabled}
            onClick={handleCheck}
          >
            检查更新
          </Button>
          <Button
            type="primary"
            icon={<HiRocketLaunch />}
            loading={installing}
            disabled={installDisabled}
            onClick={handleInstall}
          >
            重启安装
          </Button>
        </Space>
      </div>
    </div>
  )
}

export default AppUpdateSettingsPanel

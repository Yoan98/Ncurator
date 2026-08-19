import React from 'react'

type ErrorBoundaryProps = {
  children: React.ReactNode
}

type ErrorBoundaryState = {
  error: Error | null
}

/**
 * 全局错误边界：React 渲染/提交阶段的未捕获错误若没有边界拦截，
 * React 18 会卸载整棵组件树导致整页白屏。此边界拦截后展示降级 UI，
 * 并把错误信息写入 console 供排查。
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[APP-ERROR] React render failed', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            display: 'flex',
            height: '100vh',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#ffffff'
          }}
        >
          <div style={{ maxWidth: 480, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#37352F' }}>
              页面出现异常，已停止渲染
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: '#787774', wordBreak: 'break-all' }}>
              {this.state.error.message || String(this.state.error)}
            </div>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null })
              }}
              style={{
                marginTop: 16,
                padding: '6px 16px',
                border: '1px solid #EEEEEC',
                borderRadius: 6,
                background: '#FBFBFA',
                color: '#37352F',
                fontSize: 13,
                cursor: 'pointer'
              }}
            >
              重试
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary

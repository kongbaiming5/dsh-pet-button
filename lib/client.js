/**
 * dsh-pet-button — 插件页里的配置卡片。
 *
 * 挂在 plugins.row.config 的 `dsh-pet-button#pet-button` 行上：显示桌面小部件
 * 是否在运行，并提供「打开 / 隐藏 / 刷新」三个动作。动作走宿主注册的
 * /dsh-pet-button/* 本地接口。
 */

window.__ModuleLoader__.load({
  id: 'dsh-pet-button',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // 相对路径即可：桌面版的 dsh-app:// 会把请求转发到本地服务
    // （dsh-pet 的客户端也是这么调的），浏览器版同理。
    const url = (path) => path

    const S = {
      wrap: {
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        maxWidth: 720,
        color: 'var(--dsw-alias-label-primary)',
      },
      statusRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 13,
      },
      dot: (on) => ({
        width: 8,
        height: 8,
        borderRadius: 999,
        background: on ? '#28d6a8' : 'var(--dsw-alias-label-tertiary)',
        boxShadow: on ? '0 0 8px #28d6a899' : 'none',
      }),
      muted: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: 1.6 },
      row: { display: 'flex', gap: 8, flexWrap: 'wrap' },
      btn: (primary) => ({
        padding: '7px 14px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l)',
        background: primary ? 'var(--dsw-alias-state-business-primary)' : 'transparent',
        color: primary ? '#fff' : 'var(--dsw-alias-label-primary)',
        fontSize: 12.5,
        cursor: 'pointer',
      }),
    }

    function Card() {
      const [running, setRunning] = React.useState(false)
      const [loading, setLoading] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState(null)

      const refresh = React.useCallback(async () => {
        try {
          const res = await fetch(url('/dsh-pet-button/status'), { cache: 'no-store' })
          const data = await res.json()
          setRunning(Boolean(data.running))
          setNote(null)
        } catch {
          setNote('读不到开关状态（宿主接口无响应）')
        } finally {
          setLoading(false)
        }
      }, [])

      React.useEffect(() => {
        refresh()
        const timer = setInterval(refresh, 5000)
        return () => clearInterval(timer)
      }, [refresh])

      const act = async (path) => {
        setBusy(true)
        try {
          const res = await fetch(url(path), { method: 'POST' })
          if (!res.ok) setNote('操作失败（宿主返回 ' + res.status + '）')
        } catch {
          setNote('操作失败（请求没发出去）')
        }
        await refresh()
        setBusy(false)
      }

      return h('div', { style: S.wrap }, [
        h('div', { key: 'status', style: S.statusRow }, [
          h('span', { key: 'd', style: S.dot(running) }),
          h('span', { key: 't' }, loading ? '正在读取状态…' : running ? '桌面小部件已显示' : '桌面小部件未显示'),
        ]),
        h(
          'div',
          { key: 'hint', style: S.muted },
          '它是桌面右下角那张小卡片（不是 DSH 窗口里的东西）：显示时点一下就能开/关桌宠，' +
            'Harness 没开时点它会顺手把 Harness 拉起来。这个开关不随系统登录自动启动。',
        ),
        h('div', { key: 'row', style: S.row }, [
          h(
            'button',
            {
              key: 'launch',
              style: S.btn(!running),
              disabled: busy || running,
              onClick: () => act('/dsh-pet-button/launch'),
            },
            '显示到桌面',
          ),
          h(
            'button',
            {
              key: 'quit',
              style: S.btn(false),
              disabled: busy || !running,
              onClick: () => act('/dsh-pet-button/quit'),
            },
            '从桌面隐藏',
          ),
          h(
            'button',
            { key: 'refresh', style: S.btn(false), disabled: busy, onClick: refresh },
            '刷新状态',
          ),
        ]),
        note === null ? null : h('div', { key: 'note', style: S.muted }, note),
      ])
    }

    function Summary() {
      return '桌面桌宠开关小部件：在桌面上显示一张开关卡片，用来开/关桌宠。'
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const render = (props) => {
          if (props && props.view === 'summary') return Summary()
          return h(Card)
        }
        // 行详情页（点进 rows 里的那一行）
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register(
            { name: 'plugins.row.config', key: 'dsh-pet-button#pet-button' },
            render,
          ),
        )
        // 包页面（插件卡片本身），不点进详情也能看到按钮
        ctx.slots.inject('plugins.bundle.config', () =>
          ctx.slots.register(
            { name: 'plugins.bundle.config', key: 'dsh-pet-button' },
            render,
          ),
        )
      },
    }
  },
})

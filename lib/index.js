/**
 * dsh-pet-button — 桌面桌宠开关小部件的「插件页入口」。
 *
 * 小部件本身是一个独立的 macOS 小应用（~/Applications/桌宠开关.app），
 * 不随 DSH 启动。这里提供一个最小的宿主插件：注册 /dsh-pet-button/*
 * 三个本地接口，让插件页里的卡片能查状态、打开它、隐藏它。
 */

import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

export const name = 'pet-button'
export const inject = ['webServer']

/** 小部件路径（app 包 + 可执行文件里的特征串，用于进程识别） */
const APP_PATH = `${homedir()}/Applications/桌宠开关.app`
const EXE_HINT = '桌宠开关.app/Contents/MacOS/PetToggle'

/** 本包根目录（lib/ 的上一级） */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** 随包分发的小部件（首次挂载时装到 ~/Applications） */
const BUNDLED_APP = resolve(PACKAGE_ROOT, 'assets/桌宠开关.app')

/** 本插件所在的 profile 目录（.../profiles/<name>），用于判断「是不是用户把它关了」 */
const PROFILE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const BUNDLE_NAME = 'dsh-pet-button'

/**
 * 读本插件在这个 profile 里的状态：
 *   installed —— dependencies 里还有没有它（卸载 = false）
 *   enabled   —— bundles 里还有没有它（关闭 = false）
 * 读不到按"都还在"处理，避免误删。
 */
async function profileState() {
  try {
    const raw = await readFile(resolve(PROFILE_DIR, 'package.json'), 'utf8')
    const manifest = JSON.parse(raw)
    const deps = manifest?.dependencies ?? {}
    const bundles = manifest?.dsh?.profile?.bundles
    return {
      installed: Object.prototype.hasOwnProperty.call(deps, BUNDLE_NAME),
      enabled: Array.isArray(bundles) ? bundles.includes(BUNDLE_NAME) : true,
    }
  } catch {
    return { installed: true, enabled: true }
  }
}

/**
 * 首次挂载时把小部件装到 ~/Applications。
 * 别人 `dsh plugin add` 时本机并没有这个 app，得由插件自己带过去。
 */
async function ensureAppInstalled() {
  const { access, cp, mkdir } = await import('node:fs/promises')
  try {
    await access(APP_PATH)
    return true
  } catch {
    /* 没装过，往下装 */
  }
  try {
    await access(BUNDLED_APP)
  } catch {
    requestLog('bundled app missing, skip install')
    return false
  }
  try {
    await mkdir(`${homedir()}/Applications`, { recursive: true })
    await cp(BUNDLED_APP, APP_PATH, { recursive: true })
    requestLog(`installed ${APP_PATH}`)
    return true
  } catch (error) {
    requestLog(`install failed: ${error?.message ?? error}`)
    return false
  }
}

/** 卸载时把本机留下的东西全清掉：小部件本体、偏好、日志、以及可能存在的 LaunchAgent。 */
async function removeLocalArtifacts() {
  const { rm } = await import('node:fs/promises')
  const targets = [
    APP_PATH,
    `${homedir()}/.dsh/pet-button.json`,
    `${homedir()}/.dsh/pet-button.log`,
    `${homedir()}/Library/LaunchAgents/com.dsh.petbutton.launch.plist`,
  ]
  for (const target of targets) {
    try {
      await rm(target, { recursive: true, force: true })
      requestLog(`removed ${target}`)
    } catch {
      /* 删不掉就算了，不要影响卸载流程 */
    }
  }
  // 之前若用 launchd 起过 Harness，顺手把作业也撤了
  await run('/bin/launchctl', ['bootout', `gui/${process.getuid?.() ?? ''}/com.dsh.petbutton.launch`])
}

/** 用户偏好：插件页的开关状态（记住"隐藏"就不会每次随 Harness 冒出来） */
const STATE_FILE = `${homedir()}/.dsh/pet-button.json`

async function readEnabled() {
  try {
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(STATE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed.enabled !== false
  } catch {
    return true
  }
}

async function writeEnabled(enabled) {
  try {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(`${homedir()}/.dsh`, { recursive: true })
    await writeFile(STATE_FILE, JSON.stringify({ enabled }, null, 2) + '\n', 'utf8')
  } catch {
    /* 偏好写不进去不影响开关本身 */
  }
}

function run(command, args) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, { stdio: 'ignore' })
    } catch {
      resolve(-1)
      return
    }
    child.on('error', () => resolve(-1))
    child.on('close', (code) => resolve(code ?? -1))
  })
}

async function isRunning() {
  return (await run('/usr/bin/pgrep', ['-f', EXE_HINT])) === 0
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-max-age': '600',
}

function requestLog(line) {
  try {
    appendFileSync(`${homedir()}/.dsh/pet-button.log`, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* 日志失败不影响功能 */
  }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...CORS,
  })
  res.end(body)
}

export function apply(ctx) {
  // 插件生命周期 = 小部件的开关：
  //   · 插件被启用（挂载）→ 拉起小部件
  //   · 插件被禁用（卸载）→ 关掉小部件
  // 插件市场卡片上的「启用中」开关，就是这两个动作的入口。
  ctx.effect(() => {
    void ensureAppInstalled().then((ok) => {
      if (ok) void run('/usr/bin/open', [APP_PATH])
    })
    return () => {
      // 卸载/关闭都会走到这里；等清单落盘后按最终状态决定清到什么程度
      for (const delay of [400, 1500, 3000, 6000]) {
        setTimeout(() => {
          void profileState().then(async (state) => {
            if (!state.installed) {
              // 卸载：连本地 app 和痕迹一起清掉
              await run('/usr/bin/pkill', ['-f', EXE_HINT])
              await removeLocalArtifacts()
            } else if (!state.enabled) {
              // 只是关掉：留着 app，下次开启还要用
              await run('/usr/bin/pkill', ['-f', EXE_HINT])
            }
            // installed && enabled：Harness 退出，什么都不做
          })
        }, delay)
      }
    }
  }, 'dsh-pet-button: follow plugin switch')

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/dsh-pet-button',
        handler: async (req, res) => {
          // prefix 路由给到的是完整路径（/dsh-pet-button/status），先剥掉前缀
          const url = (req.url ?? '/').replace(/^\/dsh-pet-button/, '') || '/'
          requestLog(`${req.method ?? 'GET'} ${url} origin=${req.headers?.origin ?? '-'}`)
          if ((req.method ?? 'GET').toUpperCase() === 'OPTIONS') {
            res.writeHead(204, CORS)
            res.end()
            return
          }
          try {
            if (url.startsWith('/status')) {
              return json(res, 200, {
                running: await isRunning(),
                enabled: await readEnabled(),
                app: APP_PATH,
              })
            }
            if (url.startsWith('/launch') && req.method === 'POST') {
              await writeEnabled(true)
              if (await isRunning()) return json(res, 200, { ok: true, already: true })
              const code = await run('/usr/bin/open', [APP_PATH])
              return json(res, 200, { ok: code === 0, code })
            }
            if (url.startsWith('/quit') && req.method === 'POST') {
              await writeEnabled(false)
              await run('/usr/bin/pkill', ['-f', EXE_HINT])
              return json(res, 200, { ok: true })
            }
            return json(res, 404, { error: 'not found' })
          } catch (error) {
            return json(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
    'dsh-pet-button: /dsh-pet-button routes',
  )
}

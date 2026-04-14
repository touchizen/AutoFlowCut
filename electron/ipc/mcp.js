/**
 * MCP IPC Handler - Claude Code MCP Server Registration + Skill Installation
 */

import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import os from 'os'
import { app } from 'electron'

const MCP_NAME = 'autoflowcut'

function getClaudeConfigPath() {
  return path.join(os.homedir(), '.claude.json')
}

function getResourceDir(name) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, name)
  }
  return path.join(app.getAppPath(), name)
}

function getMcpServerPath() {
  return path.join(getResourceDir('mcp-server'), 'index.js')
}

function getSkillsRepoDir() {
  return getResourceDir('skills')
}

function getSkillsInstallDir() {
  return path.join(os.homedir(), '.claude', 'skills')
}

async function readConfig() {
  const configPath = getClaudeConfigPath()
  try {
    const text = await fs.readFile(configPath, 'utf-8')
    return { config: JSON.parse(text), path: configPath, exists: true }
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { config: {}, path: configPath, exists: false }
    }
    throw e
  }
}

async function writeConfig(configPath, config) {
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

// 템플릿 변수 치환
function substituteVariables(text, variables) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    if (varName in variables) return variables[varName]
    return match
  })
}

// 디렉토리 재귀 복사 (SKILL.md/metadata.json 제외)
function copyDirRecursive(src, dest) {
  fsSync.mkdirSync(dest, { recursive: true })
  for (const entry of fsSync.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else if (entry.name !== 'SKILL.md' && entry.name !== 'metadata.json') {
      fsSync.copyFileSync(srcPath, destPath)
    }
  }
}

// 단일 스킬 설치 (디렉토리에서 ~/.claude/skills/로)
function installSkillSync(skillName, variables = {}) {
  const repoDir = getSkillsRepoDir()
  const skillDir = path.join(repoDir, skillName)
  const skillMdPath = path.join(skillDir, 'SKILL.md')

  if (!fsSync.existsSync(skillMdPath)) {
    throw new Error(`Skill not found: ${skillName}`)
  }

  // metadata.json 읽기
  const metaPath = path.join(skillDir, 'metadata.json')
  let metadata = {}
  if (fsSync.existsSync(metaPath)) {
    metadata = JSON.parse(fsSync.readFileSync(metaPath, 'utf-8'))
  }

  const resolvedVars = { HOME: os.homedir(), ...variables }

  // SKILL.md 변수 치환
  let skillContent = fsSync.readFileSync(skillMdPath, 'utf-8')
  skillContent = substituteVariables(skillContent, resolvedVars)

  // 설치
  const installDir = path.join(getSkillsInstallDir(), skillName)
  copyDirRecursive(skillDir, installDir)
  fsSync.writeFileSync(path.join(installDir, 'SKILL.md'), skillContent, 'utf-8')

  const installMeta = {
    ...metadata,
    installedAt: new Date().toISOString(),
    resolvedVariables: resolvedVars,
  }
  fsSync.writeFileSync(path.join(installDir, 'metadata.json'), JSON.stringify(installMeta, null, 2), 'utf-8')

  // 의존성 자동 설치
  const installed = [skillName]
  for (const depName of metadata.dependencies || []) {
    const depDir = path.join(repoDir, depName)
    if (fsSync.existsSync(path.join(depDir, 'SKILL.md'))) {
      const depInstallDir = path.join(getSkillsInstallDir(), depName)
      copyDirRecursive(depDir, depInstallDir)
      let depContent = fsSync.readFileSync(path.join(depDir, 'SKILL.md'), 'utf-8')
      depContent = substituteVariables(depContent, resolvedVars)
      fsSync.writeFileSync(path.join(depInstallDir, 'SKILL.md'), depContent, 'utf-8')
      const depMetaPath = path.join(depDir, 'metadata.json')
      if (fsSync.existsSync(depMetaPath)) {
        fsSync.copyFileSync(depMetaPath, path.join(depInstallDir, 'metadata.json'))
      }
      installed.push(depName)
    }
  }

  return installed
}

function uninstallSkillSync(skillName) {
  const installDir = path.join(getSkillsInstallDir(), skillName)
  if (fsSync.existsSync(installDir)) {
    fsSync.rmSync(installDir, { recursive: true, force: true })
    return true
  }
  return false
}

function listAvailableSkills() {
  const repoDir = getSkillsRepoDir()
  const installDir = getSkillsInstallDir()
  if (!fsSync.existsSync(repoDir)) return []

  // 의존성으로 등장한 스킬은 "최상위" 목록에서 제외
  const depSet = new Set()
  const skills = []
  for (const dir of fsSync.readdirSync(repoDir)) {
    const skillMd = path.join(repoDir, dir, 'SKILL.md')
    if (!fsSync.existsSync(skillMd)) continue
    const metaPath = path.join(repoDir, dir, 'metadata.json')
    let metadata = null
    if (fsSync.existsSync(metaPath)) {
      try { metadata = JSON.parse(fsSync.readFileSync(metaPath, 'utf-8')) } catch {}
    }
    if (metadata?.dependencies) {
      for (const d of metadata.dependencies) depSet.add(d)
    }
    skills.push({
      name: dir,
      description: metadata?.description || '',
      version: metadata?.version || null,
      dependencies: metadata?.dependencies || [],
      installed: fsSync.existsSync(path.join(installDir, dir)),
    })
  }
  // 의존성만인 스킬은 제외, 최상위만 반환
  return skills.filter(s => !depSet.has(s.name))
}

export function registerMcpIPC(ipcMain) {
  // MCP 상태 확인
  ipcMain.handle('mcp:status', async () => {
    try {
      const { config, exists } = await readConfig()
      const servers = config.mcpServers || {}
      const registered = !!servers[MCP_NAME]
      const expectedPath = getMcpServerPath()
      const currentPath = servers[MCP_NAME]?.args?.[0]
      const needsUpdate = registered && currentPath !== expectedPath
      return {
        success: true,
        claudeCodeInstalled: exists,
        registered,
        needsUpdate,
        currentPath: currentPath || null,
        expectedPath,
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // MCP 등록
  ipcMain.handle('mcp:register', async () => {
    try {
      const { config, path: configPath } = await readConfig()
      const mcpPath = getMcpServerPath()
      try {
        await fs.access(mcpPath)
      } catch {
        return { success: false, error: `MCP server not found at: ${mcpPath}` }
      }
      if (!config.mcpServers) config.mcpServers = {}
      config.mcpServers[MCP_NAME] = { command: 'node', args: [mcpPath] }
      await writeConfig(configPath, config)
      return { success: true, path: mcpPath, configPath }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // MCP 해제
  ipcMain.handle('mcp:unregister', async () => {
    try {
      const { config, path: configPath, exists } = await readConfig()
      if (!exists || !config.mcpServers?.[MCP_NAME]) {
        return { success: true, alreadyGone: true }
      }
      delete config.mcpServers[MCP_NAME]
      await writeConfig(configPath, config)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 스킬 목록
  ipcMain.handle('skills:list', async () => {
    try {
      return { success: true, skills: listAvailableSkills() }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 스킬 설치 (복수)
  ipcMain.handle('skills:install', async (_event, { names, variables }) => {
    try {
      const installed = []
      for (const name of names || []) {
        const result = installSkillSync(name, variables || {})
        installed.push(...result)
      }
      return { success: true, installed }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 스킬 제거
  ipcMain.handle('skills:uninstall', async (_event, { name }) => {
    try {
      const removed = uninstallSkillSync(name)
      return { success: true, removed }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
}

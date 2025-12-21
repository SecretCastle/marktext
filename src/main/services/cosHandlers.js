/**
 * COS IPC 处理器
 * 处理渲染进程与主进程之间关于 COS 功能的通信
 */

import { ipcMain, BrowserWindow, dialog } from 'electron'
import log from 'electron-log'
import cosService from './cosService'
import syncService from './syncService'
import cosConfig from './cosConfig'

/**
 * 注册 COS 相关的 IPC 处理器
 * @param {Object} accessor - 应用访问器
 */
export function registerCosHandlers (accessor) {
  /**
   * 获取当前打开的项目根目录
   */
  ipcMain.handle('mt::cos-get-project-root', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)

      // 尝试从所有编辑器窗口中找到打开的项目
      const allWindows = BrowserWindow.getAllWindows()
      for (const window of allWindows) {
        const editor = accessor.windowManager.get(window.id)
        if (editor && editor._openedRootDirectory) {
          return {
            success: true,
            projectRoot: editor._openedRootDirectory
          }
        }
      }

      return {
        success: false,
        error: '没有打开的项目'
      }
    } catch (error) {
      log.error('获取项目根目录失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * 初始化 COS 配置 - 设置项目根目录
   */
  ipcMain.handle('mt::cos-init-config', async (event, projectRoot) => {
    try {
      log.info('初始化 COS 配置:', projectRoot)
      cosConfig.init(projectRoot)
      return {
        success: true,
        config: cosConfig.getAll()
      }
    } catch (error) {
      log.error('初始化 COS 配置失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * 初始化 COS 服务
   */
  ipcMain.handle('mt::cos-initialize', async (event, config) => {
    try {
      log.info('初始化 COS 服务')
      const result = cosService.initialize(config)
      return result
    } catch (error) {
      log.error('COS 初始化失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * 测试 COS 连接
   */
  ipcMain.handle('mt::cos-test-connection', async (event) => {
    try {
      log.info('测试 COS 连接')
      const result = await cosService.testConnection()
      return result
    } catch (error) {
      log.error('COS 连接测试失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * 保存 COS 配置
   */
  ipcMain.handle('mt::cos-save-config', async (event, config) => {
    try {
      log.info('保存 COS 配置')

      // 保存到 .tx/config.json
      cosConfig.setAll({
        SecretId: config.SecretId || '',
        SecretKey: config.SecretKey || '',
        Bucket: config.Bucket || '',
        Region: config.Region || ''
      })

      const result = cosConfig.saveConfig()
      if (!result.success) {
        throw new Error(result.error)
      }

      // 如果配置完整，初始化 COS 服务
      if (cosConfig.isValid()) {
        cosService.initialize({
          secretId: config.SecretId,
          secretKey: config.SecretKey,
          bucket: config.Bucket,
          region: config.Region
        })
      }

      // 广播配置更改到所有窗口
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('mt::cos-config-changed', config)
      })

      return { success: true }
    } catch (error) {
      log.error('保存 COS 配置失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * 获取 COS 配置
   */
  ipcMain.handle('mt::cos-get-config', async (event) => {
    try {
      const config = cosConfig.getAll()

      return {
        success: true,
        config: {
          SecretId: config.SecretId || '',
          SecretKey: config.SecretKey || '',
          Bucket: config.Bucket || '',
          Region: config.Region || ''
        }
      }
    } catch (error) {
      log.error('获取 COS 配置失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * 选择本地同步目录
   */
  ipcMain.handle('mt::cos-select-directory', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory'],
        title: '选择同步目录'
      })

      if (result.canceled || result.filePaths.length === 0) {
        return {
          success: false,
          cancelled: true
        }
      }

      return {
        success: true,
        path: result.filePaths[0]
      }
    } catch (error) {
      log.error('选择目录失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * 开始同步
   */
  ipcMain.handle('mt::cos-start-sync', async (event, config) => {
    try {
      log.info('开始同步操作')

      // 确保 COS 配置已初始化
      if (!config.localDir) {
        throw new Error('本地目录不能为空')
      }

      // 初始化配置文件（基于项目根目录）
      cosConfig.init(config.localDir)

      // 获取 COS 配置
      const txConfig = cosConfig.getAll()

      if (!txConfig.SecretId || !txConfig.SecretKey || !txConfig.Bucket || !txConfig.Region) {
        throw new Error('COS 配置不完整，请先在项目根目录的 .tx/.config 中配置')
      }

      // 初始化 COS 服务
      const initResult = cosService.initialize({
        secretId: txConfig.SecretId,
        secretKey: txConfig.SecretKey,
        bucket: txConfig.Bucket,
        region: txConfig.Region
      })
      if (!initResult.success) {
        throw new Error('COS 服务初始化失败: ' + initResult.error)
      }

      const win = BrowserWindow.fromWebContents(event.sender)

      // 进度回调
      const onProgress = (progressData) => {
        win.webContents.send('mt::cos-sync-progress', progressData)
      }

      const result = await syncService.startSync(config, onProgress)

      // 检查是否有冲突
      if (result.success && result.conflicts && result.conflicts.length > 0) {
        // 发送冲突消息到渲染进程
        win.webContents.send('mt::cos-sync-conflicts', {
          conflicts: result.conflicts,
          config
        })
        return {
          success: true,
          hasConflicts: true,
          conflicts: result.conflicts
        }
      }

      // 发送完成消息
      win.webContents.send('mt::cos-sync-complete', result)

      return result
    } catch (error) {
      log.error('同步操作失败:', error)
      const errorResult = {
        success: false,
        error: error.message
      }

      // 发送错误消息
      const win = BrowserWindow.fromWebContents(event.sender)
      win.webContents.send('mt::cos-sync-error', errorResult)

      return errorResult
    }
  })

  /**
   * 取消同步
   */
  ipcMain.handle('mt::cos-cancel-sync', async (event) => {
    try {
      log.info('取消同步操作')
      syncService.cancelSync()
      return { success: true }
    } catch (error) {
      log.error('取消同步失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * 解决文件冲突 - 下载用户选择的文件
   */
  ipcMain.handle('mt::cos-resolve-conflicts', async (event, selectedFiles) => {
    try {
      log.info(`解决文件冲突，下载 ${selectedFiles.length} 个文件`)

      const win = BrowserWindow.fromWebContents(event.sender)

      // 进度回调
      const onProgress = (progressData) => {
        win.webContents.send('mt::cos-sync-progress', progressData)
      }

      const result = await syncService.downloadSelectedFiles(selectedFiles, onProgress)

      // 发送完成消息
      win.webContents.send('mt::cos-sync-complete', {
        success: true,
        stats: {
          downloaded: result.downloaded.length,
          failed: result.failed.length,
          uploaded: 0,
          total: selectedFiles.length
        }
      })

      return {
        success: true,
        downloaded: result.downloaded,
        failed: result.failed
      }
    } catch (error) {
      log.error('解决冲突失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * 获取同步状态
   */
  ipcMain.handle('mt::cos-get-sync-status', async (event) => {
    try {
      const status = syncService.getSyncStatus()
      return {
        success: true,
        status
      }
    } catch (error) {
      log.error('获取同步状态失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * 列出远程文件
   */
  ipcMain.handle('mt::cos-list-files', async (event, prefix) => {
    try {
      const result = await cosService.listFiles(prefix)
      return result
    } catch (error) {
      log.error('列出文件失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * 上传单个文件
   */
  ipcMain.handle('mt::cos-upload-file', async (event, localPath, remotePath) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)

      const onProgress = (progress) => {
        win.webContents.send('mt::cos-upload-progress', {
          localPath,
          remotePath,
          progress
        })
      }

      const result = await cosService.uploadFile(localPath, remotePath, onProgress)
      return result
    } catch (error) {
      log.error('上传文件失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * 下载单个文件
   */
  ipcMain.handle('mt::cos-download-file', async (event, remotePath, localPath) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)

      const onProgress = (progress) => {
        win.webContents.send('mt::cos-download-progress', {
          remotePath,
          localPath,
          progress
        })
      }

      const result = await cosService.downloadFile(remotePath, localPath, onProgress)
      return result
    } catch (error) {
      log.error('下载文件失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  /**
   * 删除远程文件
   */
  ipcMain.handle('mt::cos-delete-file', async (event, remotePath) => {
    try {
      const result = await cosService.deleteFile(remotePath)
      return result
    } catch (error) {
      log.error('删除文件失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  log.info('COS IPC 处理器注册完成')
}

/**
 * 注销 COS 相关的 IPC 处理器
 */
export function unregisterCosHandlers () {
  const handlers = [
    'mt::cos-get-project-root',
    'mt::cos-init-config',
    'mt::cos-initialize',
    'mt::cos-test-connection',
    'mt::cos-save-config',
    'mt::cos-get-config',
    'mt::cos-select-directory',
    'mt::cos-start-sync',
    'mt::cos-cancel-sync',
    'mt::cos-get-sync-status',
    'mt::cos-list-files',
    'mt::cos-upload-file',
    'mt::cos-download-file',
    'mt::cos-delete-file'
  ]

  handlers.forEach(channel => {
    ipcMain.removeHandler(channel)
  })

  log.info('COS IPC 处理器已注销')
}

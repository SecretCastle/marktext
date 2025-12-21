/**
 * 文件同步服务模块
 * 负责本地文件与 COS 之间的双向同步
 */

import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import log from 'electron-log'
import cosService from './cosService'
import { normalizeAndResolvePath } from '../filesystem'

class SyncService {
  constructor () {
    this.syncInProgress = false
    this.syncCancelled = false
    this.syncStats = {
      uploaded: 0,
      downloaded: 0,
      failed: 0,
      total: 0
    }
  }

  /**
   * 开始同步操作
   * @param {Object} config - 同步配置
   * @param {string} config.localDir - 本地同步目录
   * @param {string} config.remotePrefix - COS 远程前缀（可选）
   * @param {string} config.direction - 同步方向: 'upload', 'download', 'bidirectional'
   * @param {Function} onProgress - 进度回调函数
   * @returns {Promise<Object>} 同步结果
   */
  async startSync (config, onProgress = null) {
    if (this.syncInProgress) {
      return {
        success: false,
        error: '同步正在进行中，请稍后再试'
      }
    }

    try {
      this.syncInProgress = true
      this.syncCancelled = false
      this.syncStats = {
        uploaded: 0,
        downloaded: 0,
        failed: 0,
        total: 0
      }

      const { localDir, remotePrefix = '', direction = 'bidirectional' } = config

      // 验证本地目录
      const normalizedPath = normalizeAndResolvePath(localDir)
      if (!normalizedPath || !fs.existsSync(normalizedPath)) {
        throw new Error(`本地目录不存在: ${localDir}`)
      }

      log.info(`开始同步: ${normalizedPath} <-> COS:${remotePrefix}`)

      let result
      switch (direction) {
        case 'upload':
          result = await this._uploadSync(normalizedPath, remotePrefix, onProgress)
          break
        case 'download':
          result = await this._downloadSync(normalizedPath, remotePrefix, onProgress)
          break
        case 'bidirectional':
        default:
          result = await this._bidirectionalSync(normalizedPath, remotePrefix, onProgress)
          break
      }

      log.info('同步完成:', this.syncStats)
      return {
        success: true,
        stats: this.syncStats,
        ...result
      }
    } catch (error) {
      log.error('同步失败:', error)
      return {
        success: false,
        error: error.message,
        stats: this.syncStats
      }
    } finally {
      this.syncInProgress = false
      this.syncCancelled = false
    }
  }

  /**
   * 取消同步
   */
  cancelSync () {
    if (this.syncInProgress) {
      this.syncCancelled = true
      log.info('同步已取消')
    }
  }

  /**
   * 上传同步：将本地文件上传到 COS
   * @private
   */
  async _uploadSync (localDir, remotePrefix, onProgress) {
    const localFiles = await this._scanLocalFiles(localDir)
    this.syncStats.total = localFiles.length

    const results = {
      uploaded: [],
      failed: []
    }

    for (const file of localFiles) {
      if (this.syncCancelled) {
        log.info('上传同步被取消')
        break
      }

      const relativePath = path.relative(localDir, file.path)
      const remotePath = remotePrefix ? `${remotePrefix}/${relativePath}` : relativePath

      // 检查远程文件是否存在且是否需要更新
      const remoteInfo = await cosService.getFileInfo(remotePath)

      let shouldUpload = true
      if (remoteInfo.success && remoteInfo.exists) {
        // 比较文件修改时间和大小
        const localMtime = file.stats.mtimeMs
        const remoteMtime = new Date(remoteInfo.lastModified).getTime()
        const localSize = file.stats.size
        const remoteSize = parseInt(remoteInfo.size)

        if (localSize === remoteSize && Math.abs(localMtime - remoteMtime) < 1000) {
          shouldUpload = false
        }
      }

      if (shouldUpload) {
        const uploadResult = await cosService.uploadFile(
          file.path,
          remotePath,
          (progress) => {
            if (onProgress) {
              onProgress({
                type: 'upload',
                file: relativePath,
                progress: progress.percent,
                stats: this.syncStats
              })
            }
          }
        )

        if (uploadResult.success) {
          this.syncStats.uploaded++
          results.uploaded.push(relativePath)
        } else {
          this.syncStats.failed++
          results.failed.push({
            file: relativePath,
            error: uploadResult.error
          })
        }
      }
    }

    return results
  }

  /**
   * 下载同步：从 COS 下载文件到本地
   * @private
   */
  async _downloadSync (localDir, remotePrefix, onProgress) {
    const remoteFiles = await cosService.listFiles(remotePrefix)

    if (!remoteFiles.success) {
      throw new Error(remoteFiles.error)
    }

    this.syncStats.total = remoteFiles.files.length

    const results = {
      downloaded: [],
      failed: [],
      conflicts: []
    }

    // 第一阶段：检测冲突
    const conflictFiles = []
    const filesToDownload = []

    for (const file of remoteFiles.files) {
      if (this.syncCancelled) {
        log.info('下载同步被取消')
        break
      }

      const remotePath = file.key
      const relativePath = remotePrefix ? remotePath.substring(remotePrefix.length + 1) : remotePath

      // 跳过目录标记
      if (relativePath.endsWith('/')) {
        continue
      }

      const localPath = path.join(localDir, relativePath)

      // 检查本地文件是否存在
      if (fs.existsSync(localPath)) {
        const localStats = fs.statSync(localPath)
        const localSize = localStats.size
        const remoteSize = file.size

        // 如果大小不同或修改时间差异较大，可能是冲突
        const localMtime = localStats.mtimeMs
        const remoteMtime = new Date(file.lastModified).getTime()
        const timeDiff = Math.abs(localMtime - remoteMtime)

        if (localSize !== remoteSize || timeDiff > 1000) {
          // 计算本地文件 MD5
          try {
            const localMD5 = await this._calculateMD5(localPath)
            // COS 的 etag 对于小文件就是 MD5，对于大文件是分片的
            // 我们使用 etag 来判断（去掉引号）
            const remoteETag = file.etag.replace(/"/g, '')

            log.info(`etag : ${remoteETag}`)
            log.info(`md5 : ${localMD5}`)

            // 如果 etag 不同，说明内容不同，是冲突
            if (localMD5 !== remoteETag) {
              conflictFiles.push({
                relativePath,
                remotePath,
                localPath,
                localSize,
                remoteSize,
                localMtime: new Date(localMtime).toLocaleString(),
                remoteMtime: new Date(remoteMtime).toLocaleString(),
                localMD5,
                remoteMD5: remoteETag
              })
            } else {
              // MD5 相同，不需要下载
              log.info(`文件内容相同，跳过: ${relativePath}`)
            }
          } catch (error) {
            log.error(`计算 MD5 失败: ${localPath}`, error)
            // 如果计算失败，仍然标记为需要下载
            filesToDownload.push({ file, remotePath, localPath, relativePath })
          }
        } else {
          // 大小和时间都相同，不需要下载
          log.info(`文件相同，跳过: ${relativePath}`)
        }
      } else {
        // 本地不存在，直接下载
        filesToDownload.push({ file, remotePath, localPath, relativePath })
      }
    }

    // 如果有冲突，需要等待用户确认
    if (conflictFiles.length > 0) {
      results.conflicts = conflictFiles
      log.info(`检测到 ${conflictFiles.length} 个文件冲突，等待用户确认`)
      return results
    }

    // 第二阶段：下载非冲突文件
    for (const { remotePath, localPath, relativePath } of filesToDownload) {
      if (this.syncCancelled) {
        log.info('下载同步被取消')
        break
      }

      const downloadResult = await cosService.downloadFile(
        remotePath,
        localPath,
        (progress) => {
          if (onProgress) {
            onProgress({
              type: 'download',
              file: relativePath,
              progress: progress.percent,
              stats: this.syncStats
            })
          }
        }
      )

      if (downloadResult.success) {
        this.syncStats.downloaded++
        results.downloaded.push(relativePath)
      } else {
        this.syncStats.failed++
        results.failed.push({
          file: relativePath,
          error: downloadResult.error
        })
      }
    }

    return results
  }

  /**
   * 下载用户选择的冲突文件
   * @param {Array} selectedFiles - 用户选择要替换的文件列表
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 下载结果
   */
  async downloadSelectedFiles (selectedFiles, onProgress = null) {
    const results = {
      downloaded: [],
      failed: []
    }

    for (const fileInfo of selectedFiles) {
      if (this.syncCancelled) break

      const { remotePath, localPath, relativePath } = fileInfo

      const downloadResult = await cosService.downloadFile(
        remotePath,
        localPath,
        (progress) => {
          if (onProgress) {
            onProgress({
              type: 'download',
              file: relativePath,
              progress: progress.percent
            })
          }
        }
      )

      if (downloadResult.success) {
        results.downloaded.push(relativePath)
      } else {
        results.failed.push({
          file: relativePath,
          error: downloadResult.error
        })
      }
    }

    return results
  }

  /**
   * 双向同步：同步本地和 COS 的文件
   * @private
   */
  async _bidirectionalSync (localDir, remotePrefix, onProgress) {
    // 获取本地和远程文件列表
    const localFiles = await this._scanLocalFiles(localDir)
    const remoteFilesResult = await cosService.listFiles(remotePrefix)

    if (!remoteFilesResult.success) {
      throw new Error(remoteFilesResult.error)
    }

    const remoteFiles = remoteFilesResult.files

    // 创建文件映射
    const localFileMap = new Map()
    localFiles.forEach(file => {
      const relativePath = path.relative(localDir, file.path)
      localFileMap.set(relativePath, file)
    })

    const remoteFileMap = new Map()
    remoteFiles.forEach(file => {
      const relativePath = remotePrefix ? file.key.substring(remotePrefix.length + 1) : file.key
      if (!relativePath.endsWith('/')) {
        remoteFileMap.set(relativePath, file)
      }
    })

    this.syncStats.total = Math.max(localFileMap.size, remoteFileMap.size)

    const results = {
      uploaded: [],
      downloaded: [],
      failed: []
    }

    // 处理本地文件（上传或更新）
    for (const [relativePath, localFile] of localFileMap) {
      if (this.syncCancelled) break

      const remotePath = remotePrefix ? `${remotePrefix}/${relativePath}` : relativePath
      const remoteFile = remoteFileMap.get(relativePath)

      if (!remoteFile) {
        // 远程不存在，上传
        const uploadResult = await cosService.uploadFile(
          localFile.path,
          remotePath,
          (progress) => {
            if (onProgress) {
              onProgress({
                type: 'upload',
                file: relativePath,
                progress: progress.percent,
                stats: this.syncStats
              })
            }
          }
        )

        if (uploadResult.success) {
          this.syncStats.uploaded++
          results.uploaded.push(relativePath)
        } else {
          this.syncStats.failed++
          results.failed.push({ file: relativePath, error: uploadResult.error })
        }
      } else {
        // 比较并同步较新的版本
        const localMtime = localFile.stats.mtimeMs
        const remoteMtime = new Date(remoteFile.lastModified).getTime()

        if (localMtime > remoteMtime + 1000) {
          // 本地更新，上传
          const uploadResult = await cosService.uploadFile(
            localFile.path,
            remotePath,
            (progress) => {
              if (onProgress) {
                onProgress({
                  type: 'upload',
                  file: relativePath,
                  progress: progress.percent,
                  stats: this.syncStats
                })
              }
            }
          )

          if (uploadResult.success) {
            this.syncStats.uploaded++
            results.uploaded.push(relativePath)
          } else {
            this.syncStats.failed++
            results.failed.push({ file: relativePath, error: uploadResult.error })
          }
        } else if (remoteMtime > localMtime + 1000) {
          // 远程更新，下载
          const downloadResult = await cosService.downloadFile(
            remotePath,
            localFile.path,
            (progress) => {
              if (onProgress) {
                onProgress({
                  type: 'download',
                  file: relativePath,
                  progress: progress.percent,
                  stats: this.syncStats
                })
              }
            }
          )

          if (downloadResult.success) {
            this.syncStats.downloaded++
            results.downloaded.push(relativePath)
          } else {
            this.syncStats.failed++
            results.failed.push({ file: relativePath, error: downloadResult.error })
          }
        }
      }
    }

    // 处理远程独有的文件（下载）
    for (const [relativePath] of remoteFileMap) {
      if (this.syncCancelled) break

      if (!localFileMap.has(relativePath)) {
        const localPath = path.join(localDir, relativePath)
        const remotePath = remotePrefix ? `${remotePrefix}/${relativePath}` : relativePath

        const downloadResult = await cosService.downloadFile(
          remotePath,
          localPath,
          (progress) => {
            if (onProgress) {
              onProgress({
                type: 'download',
                file: relativePath,
                progress: progress.percent,
                stats: this.syncStats
              })
            }
          }
        )

        if (downloadResult.success) {
          this.syncStats.downloaded++
          results.downloaded.push(relativePath)
        } else {
          this.syncStats.failed++
          results.failed.push({ file: relativePath, error: downloadResult.error })
        }
      }
    }

    return results
  }

  /**
   * 扫描本地目录获取所有文件
   * @private
   * @param {string} dir - 目录路径
   * @param {Array} fileList - 文件列表（递归使用）
   * @returns {Promise<Array>} 文件列表
   */
  async _scanLocalFiles (dir, fileList = []) {
    const files = await fsPromises.readdir(dir)

    for (const file of files) {
      const filePath = path.join(dir, file)
      const stats = await fsPromises.stat(filePath)

      if (stats.isDirectory()) {
        // 递归扫描子目录
        await this._scanLocalFiles(filePath, fileList)
      } else if (stats.isFile()) {
        // 只同步 markdown 文件
        if (this._isMarkdownFile(file)) {
          fileList.push({
            path: filePath,
            stats
          })
        }
      }
    }

    return fileList
  }

  /**
   * 检查是否为 Markdown 文件
   * @private
   * @param {string} filename - 文件名
   * @returns {boolean}
   */
  _isMarkdownFile (filename) {
    const ext = path.extname(filename).toLowerCase()
    return ext === '.md' || ext === '.markdown' || ext === '.mdown' || ext === '.mkd'
  }

  /**
   * 计算文件的 MD5 哈希值
   * @private
   * @param {string} filePath - 文件路径
   * @returns {Promise<string>} MD5 哈希值
   */
  async _calculateMD5 (filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5')
      const stream = fs.createReadStream(filePath)

      stream.on('data', data => hash.update(data))
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', err => reject(err))
    })
  }

  /**
   * 获取同步状态
   * @returns {Object}
   */
  getSyncStatus () {
    return {
      inProgress: this.syncInProgress,
      stats: this.syncStats
    }
  }
}

// 导出单例
export default new SyncService()

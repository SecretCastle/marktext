/**
 * 腾讯云对象存储 (COS) 服务模块
 * 封装 COS SDK 提供文件上传、下载和管理功能
 */

import COS from 'cos-nodejs-sdk-v5'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import log from 'electron-log'

class CosService {
  constructor () {
    this.cos = null
    this.config = null
  }

  /**
   * 初始化 COS 客户端
   * @param {Object} config - COS 配置对象
   * @param {string} config.secretId - 腾讯云 SecretId
   * @param {string} config.secretKey - 腾讯云 SecretKey
   * @param {string} config.bucket - 存储桶名称
   * @param {string} config.region - 地域
   */
  initialize (config) {
    try {
      if (!config || !config.secretId || !config.secretKey) {
        throw new Error('COS 配置信息不完整：缺少 SecretId 或 SecretKey')
      }

      this.config = config
      this.cos = new COS({
        SecretId: config.secretId,
        SecretKey: config.secretKey
      })

      log.info('COS 服务初始化成功')
      return { success: true }
    } catch (error) {
      log.error('COS 服务初始化失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 测试 COS 连接
   * @returns {Promise<Object>} 测试结果
   */
  async testConnection () {
    return new Promise((resolve, reject) => {
      if (!this.cos || !this.config) {
        reject(new Error('COS 服务未初始化'))
        return
      }

      const { bucket, region } = this.config

      if (!bucket || !region) {
        reject(new Error('存储桶或地域配置缺失'))
        return
      }

      // 测试获取存储桶信息
      this.cos.headBucket({
        Bucket: bucket,
        Region: region
      }, (err, data) => {
        if (err) {
          log.error('COS 连接测试失败:', err)
          resolve({
            success: false,
            error: this._parseError(err)
          })
        } else {
          log.info('COS 连接测试成功')
          resolve({
            success: true,
            message: '连接成功'
          })
        }
      })
    })
  }

  /**
   * 上传文件到 COS
   * @param {string} localPath - 本地文件路径
   * @param {string} remotePath - COS 远程路径（对象键）
   * @param {Function} onProgress - 进度回调函数
   * @returns {Promise<Object>} 上传结果
   */
  async uploadFile (localPath, remotePath, onProgress = null) {
    return new Promise((resolve, reject) => {
      if (!this.cos || !this.config) {
        reject(new Error('COS 服务未初始化'))
        return
      }

      // 验证文件是否存在
      if (!fs.existsSync(localPath)) {
        reject(new Error(`文件不存在: ${localPath}`))
        return
      }

      const { bucket, region } = this.config

      log.info(`开始上传文件: ${localPath} -> ${remotePath}`)

      this.cos.uploadFile({
        Bucket: bucket,
        Region: region,
        Key: remotePath,
        FilePath: localPath,
        onProgress: (progressData) => {
          if (onProgress && typeof onProgress === 'function') {
            const percent = Math.round(progressData.percent * 100)
            onProgress({
              percent,
              loaded: progressData.loaded,
              total: progressData.total,
              speed: progressData.speed
            })
          }
        }
      }, (err, data) => {
        if (err) {
          log.error(`文件上传失败: ${localPath}`, err)
          resolve({
            success: false,
            error: this._parseError(err),
            localPath,
            remotePath
          })
        } else {
          log.info(`文件上传成功: ${remotePath}`)
          resolve({
            success: true,
            data,
            localPath,
            remotePath,
            url: data.Location
          })
        }
      })
    })
  }

  /**
   * 从 COS 下载文件
   * @param {string} remotePath - COS 远程路径（对象键）
   * @param {string} localPath - 本地文件保存路径
   * @param {Function} onProgress - 进度回调函数
   * @returns {Promise<Object>} 下载结果
   */
  async downloadFile (remotePath, localPath, onProgress = null) {
    return new Promise(async (resolve, reject) => {
      if (!this.cos || !this.config) {
        reject(new Error('COS 服务未初始化'))
        return
      }

      const { bucket, region } = this.config

      // 统一路径分隔符为 /
      const normalizedRemotePath = remotePath.replace(/\\/g, '/')

      // 从 localPath 中提取相对路径部分
      // 将反斜杠转换为斜杠，然后尝试匹配远程路径
      const normalizedLocalPath = localPath.replace(/\\/g, '/')
      // 提取路径中与 remotePath 对应的部分（去掉目录前缀）
      const pathParts = normalizedLocalPath.split('/')
      const remotePathParts = normalizedRemotePath.split('/')
      // 获取本地路径的后缀部分作为相对路径
      const localRelativePath = pathParts.slice(-remotePathParts.length).join('/')

      // 检查本地文件是否存在
      if (fs.existsSync(localPath)) {
        try {
          log.info(`本地文件已存在，开始检查是否需要下载: ${localPath}`)

          // 获取远程文件信息
          const remoteInfo = await this.getFileInfo(remotePath)
          log.info(`远程文件信息获取结果: success=${remoteInfo.success}, exists=${remoteInfo.exists}`)

          if (remoteInfo.success && remoteInfo.exists) {
            // 计算本地文件 MD5
            const localMD5 = await this._calculateMD5(localPath)
            const remoteETag = remoteInfo.etag.replace(/"/g, '')

            log.info(`路径比较 - 本地相对路径: ${localRelativePath}, 远程: ${normalizedRemotePath}`)
            log.info(`路径是否相同: ${localRelativePath === normalizedRemotePath}`)
            log.info(`MD5 比较 - 本地: ${localMD5}, 远程: ${remoteETag}`)
            log.info(`MD5 是否相同: ${localMD5 === remoteETag}`)

            // 如果相对路径相同且 MD5 相同，跳过下载
            if (localRelativePath === normalizedRemotePath && localMD5 === remoteETag) {
              log.info(`文件已存在且内容相同，跳过下载: ${localPath}`)
              resolve({
                success: true,
                skipped: true,
                message: '文件已存在且内容相同',
                remotePath,
                localPath
              })
              return
            } else {
              log.info('文件需要下载：路径或内容不同')
            }
          } else {
            log.info('远程文件不存在或获取失败，继续下载')
          }
        } catch (error) {
          log.warn(`检查文件时出错，继续下载: ${error.message}`)
          log.error('错误详情:', error)
          // 如果检查失败，继续执行下载
        }
      } else {
        log.info(`本地文件不存在，需要下载: ${localPath}`)
      }

      // 确保目标目录存在
      const dir = path.dirname(localPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      log.info(`开始下载文件: ${remotePath} -> ${localPath}`)

      this.cos.getObject({
        Bucket: bucket,
        Region: region,
        Key: remotePath,
        Output: fs.createWriteStream(localPath),
        onProgress: (progressData) => {
          if (onProgress && typeof onProgress === 'function') {
            const percent = Math.round(progressData.percent * 100)
            onProgress({
              percent,
              loaded: progressData.loaded,
              total: progressData.total,
              speed: progressData.speed
            })
          }
        }
      }, (err, data) => {
        if (err) {
          log.error(`文件下载失败: ${remotePath}`, err)
          // 删除可能创建的空文件
          if (fs.existsSync(localPath)) {
            try {
              fs.unlinkSync(localPath)
            } catch (e) {
              log.error('清理失败的下载文件时出错:', e)
            }
          }
          resolve({
            success: false,
            error: this._parseError(err),
            remotePath,
            localPath
          })
        } else {
          log.info(`文件下载成功: ${localPath}`)
          resolve({
            success: true,
            data,
            remotePath,
            localPath
          })
        }
      })
    })
  }

  /**
   * 列出 COS 存储桶中的文件
   * @param {string} prefix - 前缀（目录路径）
   * @param {number} maxKeys - 最大返回数量
   * @returns {Promise<Object>} 文件列表
   */
  async listFiles (prefix = '', maxKeys = 1000) {
    return new Promise((resolve, reject) => {
      if (!this.cos || !this.config) {
        reject(new Error('COS 服务未初始化'))
        return
      }

      const { bucket, region } = this.config

      this.cos.getBucket({
        Bucket: bucket,
        Region: region,
        Prefix: prefix,
        MaxKeys: maxKeys
      }, (err, data) => {
        if (err) {
          log.error('获取文件列表失败:', err)
          resolve({
            success: false,
            error: this._parseError(err)
          })
        } else {
          log.info(`获取文件列表成功，共 ${data.Contents.length} 个文件`)
          resolve({
            success: true,
            files: data.Contents.map(item => ({
              key: item.Key,
              size: item.Size,
              lastModified: item.LastModified,
              etag: item.ETag
            })),
            prefix: data.Prefix,
            isTruncated: data.IsTruncated
          })
        }
      })
    })
  }

  /**
   * 删除 COS 中的文件
   * @param {string} remotePath - COS 远程路径（对象键）
   * @returns {Promise<Object>} 删除结果
   */
  async deleteFile (remotePath) {
    return new Promise((resolve, reject) => {
      if (!this.cos || !this.config) {
        reject(new Error('COS 服务未初始化'))
        return
      }

      const { bucket, region } = this.config

      log.info(`删除文件: ${remotePath}`)

      this.cos.deleteObject({
        Bucket: bucket,
        Region: region,
        Key: remotePath
      }, (err, data) => {
        if (err) {
          log.error(`文件删除失败: ${remotePath}`, err)
          resolve({
            success: false,
            error: this._parseError(err),
            remotePath
          })
        } else {
          log.info(`文件删除成功: ${remotePath}`)
          resolve({
            success: true,
            data,
            remotePath
          })
        }
      })
    })
  }

  /**
   * 获取文件信息
   * @param {string} remotePath - COS 远程路径（对象键）
   * @returns {Promise<Object>} 文件信息
   */
  async getFileInfo (remotePath) {
    return new Promise((resolve, reject) => {
      if (!this.cos || !this.config) {
        reject(new Error('COS 服务未初始化'))
        return
      }

      const { bucket, region } = this.config

      this.cos.headObject({
        Bucket: bucket,
        Region: region,
        Key: remotePath
      }, (err, data) => {
        if (err) {
          if (err.statusCode === 404) {
            resolve({
              success: true,
              exists: false,
              remotePath
            })
          } else {
            log.error(`获取文件信息失败: ${remotePath}`, err)
            resolve({
              success: false,
              error: this._parseError(err),
              remotePath
            })
          }
        } else {
          resolve({
            success: true,
            exists: true,
            remotePath,
            size: data.headers['content-length'],
            lastModified: data.headers['last-modified'],
            etag: data.headers.etag
          })
        }
      })
    })
  }

  /**
   * 解析 COS 错误
   * @private
   * @param {Error} err - 错误对象
   * @returns {string} 错误消息
   */
  _parseError (err) {
    if (err.code === 'NoSuchBucket') {
      return '存储桶不存在，请检查存储桶名称'
    } else if (err.code === 'AccessDenied') {
      return '访问被拒绝，请检查 SecretId 和 SecretKey'
    } else if (err.code === 'NoSuchKey') {
      return '文件不存在'
    } else if (err.code === 'NetworkError') {
      return '网络错误，请检查网络连接'
    } else if (err.statusCode === 403) {
      return '无权限访问，请检查凭证和存储桶权限'
    } else if (err.statusCode === 404) {
      return '资源不存在'
    }
    return err.message || '未知错误'
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
   * 销毁 COS 服务
   */
  destroy () {
    this.cos = null
    this.config = null
    log.info('COS 服务已销毁')
  }
}

// 导出单例
export default new CosService()

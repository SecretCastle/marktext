/**
 * COS 配置管理模块
 * 管理项目根目录下 .tx/.config 中的 COS 配置
 * 配置格式为键值对: key=value
 */

import fs from 'fs'
import path from 'path'
import log from 'electron-log'

class CosConfig {
  constructor () {
    this.config = null
    this.configPath = null
  }

  /**
   * 初始化配置 - 设置项目根目录
   * @param {string} projectRoot - 项目根目录路径
   */
  init (projectRoot) {
    if (!projectRoot) {
      throw new Error('项目根目录不能为空')
    }

    const txDir = path.join(projectRoot, '.tx')
    this.configPath = path.join(txDir, '.config')

    // 确保 .tx 目录存在
    if (!fs.existsSync(txDir)) {
      fs.mkdirSync(txDir, { recursive: true })
      log.info(`创建 .tx 目录: ${txDir}`)
    }

    // 加载配置
    this.loadConfig()
  }

  /**
   * 加载配置文件
   * @private
   */
  loadConfig () {
    if (!this.configPath) {
      this.config = this._getDefaultConfig()
      return
    }

    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf8')
        this.config = this._parseConfig(content)
        log.info('加载 COS 配置成功')
      } else {
        // 配置文件不存在，使用默认配置
        this.config = this._getDefaultConfig()
        this.saveConfig()
      }
    } catch (error) {
      log.error('加载 COS 配置失败:', error)
      this.config = this._getDefaultConfig()
    }
  }

  /**
   * 保存配置文件
   */
  saveConfig () {
    if (!this.configPath) {
      throw new Error('配置路径未初始化，请先调用 init()')
    }

    try {
      const content = this._stringifyConfig(this.config)
      fs.writeFileSync(this.configPath, content, 'utf8')
      log.info('保存 COS 配置成功')
      return { success: true }
    } catch (error) {
      log.error('保存 COS 配置失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 解析配置文件内容（键值对格式）
   * @private
   * @param {string} content - 配置文件内容
   * @returns {Object} 配置对象
   */
  _parseConfig (content) {
    const config = this._getDefaultConfig()
    const lines = content.split('\n')

    for (const line of lines) {
      const trimmedLine = line.trim()
      // 跳过空行和注释
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue
      }

      const equalIndex = trimmedLine.indexOf('=')
      if (equalIndex === -1) {
        continue
      }

      const key = trimmedLine.substring(0, equalIndex).trim()
      const value = trimmedLine.substring(equalIndex + 1).trim()

      if (config.hasOwnProperty(key)) {
        config[key] = value
      }
    }

    return config
  }

  /**
   * 将配置对象转换为键值对格式
   * @private
   * @param {Object} config - 配置对象
   * @returns {string} 配置文件内容
   */
  _stringifyConfig (config) {
    const lines = [
      '# Tencent Cloud COS Configuration',
      '# 腾讯云 COS 配置文件',
      '',
      `SecretId=${config.SecretId || ''}`,
      `SecretKey=${config.SecretKey || ''}`,
      `Bucket=${config.Bucket || ''}`,
      `Region=${config.Region || ''}`
    ]
    return lines.join('\n')
  }

  /**
   * 获取配置项
   * @param {string} key - 配置键名
   * @returns {*} 配置值
   */
  get (key) {
    if (!this.config) {
      this.config = this._getDefaultConfig()
    }
    return this.config[key]
  }

  /**
   * 设置配置项
   * @param {string} key - 配置键名
   * @param {*} value - 配置值
   */
  set (key, value) {
    if (!this.config) {
      this.config = this._getDefaultConfig()
    }
    this.config[key] = value
  }

  /**
   * 获取所有配置
   * @returns {Object} 配置对象
   */
  getAll () {
    if (!this.config) {
      this.config = this._getDefaultConfig()
    }
    return { ...this.config }
  }

  /**
   * 设置多个配置项
   * @param {Object} configs - 配置对象
   */
  setAll (configs) {
    if (!this.config) {
      this.config = this._getDefaultConfig()
    }
    Object.assign(this.config, configs)
  }

  /**
   * 检查配置是否完整
   * @returns {boolean}
   */
  isValid () {
    if (!this.config) {
      return false
    }
    return !!(
      this.config.SecretId &&
      this.config.SecretKey &&
      this.config.Bucket &&
      this.config.Region
    )
  }

  /**
   * 获取配置文件路径
   * @returns {string|null}
   */
  getConfigPath () {
    return this.configPath
  }

  /**
   * 重置配置
   */
  reset () {
    this.config = this._getDefaultConfig()
    this.saveConfig()
  }

  /**
   * 获取默认配置
   * @private
   * @returns {Object}
   */
  _getDefaultConfig () {
    return {
      SecretId: '',
      SecretKey: '',
      Bucket: '',
      Region: ''
    }
  }
}

// 导出单例
export default new CosConfig()

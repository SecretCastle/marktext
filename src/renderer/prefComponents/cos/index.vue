<template>
  <div class="pref-cos">
    <h4>Tencent Cloud COS</h4>

    <!-- 启用/禁用 COS 同步 -->
    <!-- <compound>
      <template #head>
        <h6 class="title">COS Sync:</h6>
      </template>
      <template #children>
        <bool
          description="Enable Tencent Cloud COS synchronization"
          :bool="cosEnabled"
          :onChange="value => onSelectChange('cosEnabled', value)"
        ></bool>
      </template>
    </compound> -->

    <!-- COS 认证配置 -->
    <compound v-if="hasProject">
      <template #head>
        <h6 class="title">Authentication:</h6>
      </template>
      <template #children>
        <text-box
          description="Secret ID"
          notes="Your Tencent Cloud Secret ID"
          :input="SecretId"
          :onChange="value => onConfigChange('SecretId', value)"
          type="password"
        ></text-box>
        <text-box
          description="Secret Key"
          notes="Your Tencent Cloud Secret Key"
          :input="SecretKey"
          :onChange="value => onConfigChange('SecretKey', value)"
          type="password"
        ></text-box>
      </template>
    </compound>

    <!-- COS 存储桶配置 -->
    <compound v-if="hasProject">
      <template #head>
        <h6 class="title">Bucket Configuration:</h6>
      </template>
      <template #children>
        <text-box
          description="Bucket Name"
          notes="The name of your COS bucket"
          :input="Bucket"
          :onChange="value => onConfigChange('Bucket', value)"
          placeholder="example-bucket-1234567890"
        ></text-box>
        <cur-select
          description="Region"
          notes="The region where your bucket is located"
          :value="Region"
          :options="cosRegionOptions"
          :onChange="value => onConfigChange('Region', value)"
        ></cur-select>
      </template>
    </compound>

    <!-- 同步设置 -->
    <compound v-if="cosEnabled && hasProject">
      <template #head>
        <h6 class="title">Sync Settings:</h6>
      </template>
      <template #children>
        <section class="info-box">
          <div class="description">
            <span class="desc-text">Local Sync Directory</span>
            <span class="notes">The currently opened folder will be used as the sync directory</span>
          </div>
        </section>

        <text-box
          description="Remote Prefix"
          notes="Optional: The prefix (directory) in COS bucket"
          :input="cosRemotePrefix"
          :onChange="value => onSelectChange('cosRemotePrefix', value)"
          placeholder="markdown-files"
        ></text-box>

        <cur-select
          description="Sync Direction"
          notes="Choose how files should be synchronized"
          :value="cosSyncDirection"
          :options="cosSyncDirectionOptions"
          :onChange="value => onSelectChange('cosSyncDirection', value)"
        ></cur-select>
      </template>
    </compound>

    <!-- 连接测试 -->
    <compound v-if="cosEnabled && hasProject && isConfigValid">
      <template #head>
        <h6 class="title">Connection:</h6>
      </template>
      <template #children>
        <section class="connection-test">
          <el-button
            :loading="testingConnection"
            @click="testConnection"
            :disabled="!canTestConnection"
          >
            Test Connection
          </el-button>
          <span v-if="connectionTestResult" :class="connectionTestResult.success ? 'success' : 'error'">
            {{ connectionTestResult.message }}
          </span>
        </section>
      </template>
    </compound>
  </div>
</template>

<script>
import { mapState } from 'vuex'
import { ipcRenderer } from 'electron'
import Compound from '../common/compound'
import Bool from '../common/bool'
import CurSelect from '../common/select'
import TextBox from '../common/textBox'

export default {
  components: {
    Compound,
    Bool,
    CurSelect,
    TextBox
  },
  data () {
    this.cosRegionOptions = [
      { value: 'ap-beijing', label: 'Beijing (ap-beijing)' },
      { value: 'ap-shanghai', label: 'Shanghai (ap-shanghai)' },
      { value: 'ap-guangzhou', label: 'Guangzhou (ap-guangzhou)' },
      { value: 'ap-chengdu', label: 'Chengdu (ap-chengdu)' },
      { value: 'ap-chongqing', label: 'Chongqing (ap-chongqing)' },
      { value: 'ap-nanjing', label: 'Nanjing (ap-nanjing)' },
      { value: 'ap-hongkong', label: 'Hong Kong (ap-hongkong)' },
      { value: 'ap-singapore', label: 'Singapore (ap-singapore)' },
      { value: 'ap-tokyo', label: 'Tokyo (ap-tokyo)' },
      { value: 'ap-seoul', label: 'Seoul (ap-seoul)' },
      { value: 'na-siliconvalley', label: 'Silicon Valley (na-siliconvalley)' },
      { value: 'na-ashburn', label: 'Virginia (na-ashburn)' },
      { value: 'eu-frankfurt', label: 'Frankfurt (eu-frankfurt)' }
    ]

    this.cosSyncDirectionOptions = [
      { value: 'bidirectional', label: 'Bidirectional - Keep local and remote in sync' },
      { value: 'upload', label: 'Upload Only - Local to COS' },
      { value: 'download', label: 'Download Only - COS to Local' }
    ]

    return {
      testingConnection: false,
      connectionTestResult: null,
      SecretId: '',
      SecretKey: '',
      Bucket: '',
      Region: '',
      currentProjectRoot: null // 当前打开的项目根目录
    }
  },
  computed: {
    ...mapState({
      cosEnabled: state => state.preferences.cosEnabled,
      cosRemotePrefix: state => state.preferences.cosRemotePrefix,
      cosSyncDirection: state => state.preferences.cosSyncDirection,
      projectTree: state => state.project.projectTree,
      storeSecretId: state => state.preferences.cosSecretId,
      storeSecretKey: state => state.preferences.cosSecretKey,
      storeBucket: state => state.preferences.cosBucket,
      storeRegion: state => state.preferences.cosRegion
    }),
    hasProject () {
      // 在设置窗口中，projectTree 总是 null
      // 所以我们使用 currentProjectRoot 来判断
      return !!this.currentProjectRoot
    },
    isConfigValid () {
      return this.SecretId && this.SecretKey && this.Bucket && this.Region
    },
    canTestConnection () {
      return this.isConfigValid && !this.testingConnection
    }
  },
  watch: {
    cosEnabled (value) {
      if (value && this.isConfigValid) {
        this.initializeCOS()
      }
    },
    // 监听 store 中的配置变化，同步到本地
    storeSecretId (val) {
      if (val !== this.SecretId) {
        this.SecretId = val
      }
    },
    storeSecretKey (val) {
      if (val !== this.SecretKey) {
        this.SecretKey = val
      }
    },
    storeBucket (val) {
      if (val !== this.Bucket) {
        this.Bucket = val
      }
    },
    storeRegion (val) {
      if (val !== this.Region) {
        this.Region = val
      }
    }
  },
  methods: {
    onSelectChange (type, value) {
      this.$store.dispatch('SET_SINGLE_PREFERENCE', { type, value })
    },
    onConfigChange (key, value) {
      this[key] = value
      this.connectionTestResult = null

      // 自动保存配置
      this.debouncedSaveConfig()
    },
    async loadConfig () {
      try {
        // 从主进程获取当前打开的项目根目录
        const projectRootResult = await ipcRenderer.invoke('mt::cos-get-project-root')

        if (!projectRootResult.success || !projectRootResult.projectRoot) {
          console.warn('没有打开的项目，无法加载 COS 配置')
          this.currentProjectRoot = null
          return
        }

        const projectRoot = projectRootResult.projectRoot
        this.currentProjectRoot = projectRoot
        console.log('获取到项目根目录:', projectRoot)

        // 初始化配置（基于项目根目录）
        const initResult = await ipcRenderer.invoke('mt::cos-init-config', projectRoot)
        if (initResult.success && initResult.config) {
          this.SecretId = initResult.config.SecretId || ''
          this.SecretKey = initResult.config.SecretKey || ''
          this.Bucket = initResult.config.Bucket || ''
          this.Region = initResult.config.Region || ''
        }
      } catch (error) {
        console.error('Failed to load COS config:', error)
        this.currentProjectRoot = null
      }
    },
    async saveConfig () {
      try {
        // 从主进程获取当前打开的项目根目录
        const projectRootResult = await ipcRenderer.invoke('mt::cos-get-project-root')

        if (!projectRootResult.success || !projectRootResult.projectRoot) {
          console.warn('没有打开的项目，无法保存 COS 配置')
          return
        }

        const projectRoot = projectRootResult.projectRoot

        const config = {
          SecretId: this.SecretId,
          SecretKey: this.SecretKey,
          Bucket: this.Bucket,
          Region: this.Region
        }

        // 先初始化配置路径
        await ipcRenderer.invoke('mt::cos-init-config', projectRoot)

        const result = await ipcRenderer.invoke('mt::cos-save-config', config)
        if (!result.success) {
          console.error('Failed to save COS config:', result.error)
        } else {
          console.log('COS config saved successfully')
        }
      } catch (error) {
        console.error('Failed to save COS config:', error)
      }
    },
    debouncedSaveConfig () {
      clearTimeout(this._saveTimer)
      this._saveTimer = setTimeout(() => {
        this.saveConfig()
      }, 1000)
    },
    async initializeCOS () {
      try {
        const config = {
          secretId: this.SecretId,
          secretKey: this.SecretKey,
          bucket: this.Bucket,
          region: this.Region
        }

        const result = await ipcRenderer.invoke('mt::cos-initialize', config)
        if (!result.success) {
          console.error('COS initialization failed:', result.error)
        }
      } catch (error) {
        console.error('Failed to initialize COS:', error)
      }
    },
    async testConnection () {
      this.testingConnection = true
      this.connectionTestResult = null

      try {
        // 首先初始化 COS
        await this.initializeCOS()

        // 测试连接
        const result = await ipcRenderer.invoke('mt::cos-test-connection')

        if (result.success) {
          this.connectionTestResult = {
            success: true,
            message: '连接成功！COS 配置正确。'
          }
          this.$message.success('COS 连接测试成功')
        } else {
          this.connectionTestResult = {
            success: false,
            message: '连接失败: ' + result.error
          }
          this.$message.error('COS 连接测试失败: ' + result.error)
        }
      } catch (error) {
        console.error('Connection test failed:', error)
        this.connectionTestResult = {
          success: false,
          message: '连接失败: ' + error.message
        }
        this.$message.error('连接测试失败: ' + error.message)
      } finally {
        this.testingConnection = false
      }
    }
  },
  mounted () {
    // 从 store 中初始化配置（如果已有）
    this.SecretId = this.storeSecretId || ''
    this.SecretKey = this.storeSecretKey || ''
    this.Bucket = this.storeBucket || ''
    this.Region = this.storeRegion || ''

    // 尝试加载项目配置
    // 这会设置 currentProjectRoot，从而更新 hasProject
    this.loadConfig()
  },
  beforeDestroy () {
    // 清理定时器
    if (this._saveTimer) {
      clearTimeout(this._saveTimer)
    }
  }
}
</script>

<style scoped>
.pref-cos {
  h4 {
    margin-top: 0;
    margin-bottom: 30px;
    font-size: 24px;
    font-weight: 300;
    color: var(--editorColor);
  }

  h6.title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--editorColor80);
  }

  .warning-box {
    margin-bottom: 30px;
    padding: 20px;
    background: #fff3cd;
    border: 1px solid #ffc107;
    border-radius: 4px;

    .warning-content {
      display: flex;
      align-items: flex-start;
      gap: 12px;

      .warning-icon {
        font-size: 20px;
        flex-shrink: 0;
      }

      .warning-text {
        flex: 1;

        strong {
          display: block;
          color: #856404;
          font-size: 14px;
          margin-bottom: 8px;
        }

        p {
          margin: 0;
          color: #856404;
          font-size: 13px;
          line-height: 1.5;
        }
      }
    }
  }

  .info-box {
    padding: 15px 0;
    border-bottom: 1px solid var(--floatBorderColor);

    .description {
      display: flex;
      flex-direction: column;

      .desc-text {
        font-size: 14px;
        color: var(--editorColor);
        margin-bottom: 5px;
      }

      .notes {
        font-size: 12px;
        color: var(--editorColor50);
      }
    }
  }

  .connection-test {
    display: flex;
    align-items: center;
    gap: 15px;
    padding: 15px 0;

    .success {
      color: #67c23a;
      font-size: 14px;
    }

    .error {
      color: #f56c6c;
      font-size: 14px;
    }
  }
}
</style>

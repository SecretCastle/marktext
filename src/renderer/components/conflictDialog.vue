<template>
  <div class="conflict-dialog-overlay" v-if="visible" @click.self="handleCancel">
    <div class="conflict-dialog">
      <div class="dialog-header">
        <h3>文件冲突</h3>
        <button class="close-btn" @click="handleCancel">×</button>
      </div>

      <div class="dialog-body">
        <p class="description">
          检测到 {{ conflicts.length }} 个文件冲突。这些文件在本地和云端都有修改，但内容不同（MD5 值不同）。
          请选择需要用云端版本替换本地版本的文件。
        </p>

        <div class="file-list">
          <div class="list-header">
            <label class="checkbox-item">
              <input
                type="checkbox"
                :checked="allSelected"
                @change="toggleSelectAll"
              />
              <span class="checkbox-label bold">全选</span>
            </label>
          </div>

          <div class="conflict-item" v-for="(file, index) in conflicts" :key="index">
            <label class="checkbox-item">
              <input
                type="checkbox"
                v-model="selectedFiles"
                :value="file"
              />
              <div class="file-info">
                <div class="file-name">{{ file.relativePath }}</div>
                <div class="file-details">
                  <span class="detail-item">
                    <span class="label">本地:</span>
                    <span class="value">{{ formatSize(file.localSize) }}</span>
                    <span class="value muted">{{ file.localMtime }}</span>
                  </span>
                  <span class="detail-item">
                    <span class="label">云端:</span>
                    <span class="value">{{ formatSize(file.remoteSize) }}</span>
                    <span class="value muted">{{ file.remoteMtime }}</span>
                  </span>
                </div>
              </div>
            </label>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-secondary" @click="handleCancel">
          取消
        </button>
        <button
          class="btn btn-primary"
          @click="handleConfirm"
          :disabled="selectedFiles.length === 0"
        >
          替换选中的文件 ({{ selectedFiles.length }})
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import bus from '../bus'

export default {
  name: 'ConflictDialog',
  data () {
    return {
      visible: false,
      conflicts: [],
      selectedFiles: [],
      config: null
    }
  },
  computed: {
    allSelected () {
      return this.conflicts.length > 0 && this.selectedFiles.length === this.conflicts.length
    }
  },
  created () {
    bus.$on('SHOW_COS_CONFLICT_DIALOG', this.show)
  },
  beforeDestroy () {
    bus.$off('SHOW_COS_CONFLICT_DIALOG', this.show)
  },
  methods: {
    show (data) {
      this.conflicts = data.conflicts || []
      this.config = data.config
      this.selectedFiles = []
      this.visible = true
    },
    hide () {
      this.visible = false
      this.conflicts = []
      this.selectedFiles = []
      this.config = null
    },
    toggleSelectAll (event) {
      if (event.target.checked) {
        this.selectedFiles = [...this.conflicts]
      } else {
        this.selectedFiles = []
      }
    },
    handleCancel () {
      this.hide()
    },
    async handleConfirm () {
      if (this.selectedFiles.length === 0) {
        return
      }

      try {
        await this.$store.dispatch('RESOLVE_CONFLICTS', this.selectedFiles)
        this.$message.success(`已替换 ${this.selectedFiles.length} 个文件`)
        this.hide()
      } catch (error) {
        console.error('解决冲突失败:', error)
        this.$message.error('解决冲突失败: ' + error.message)
      }
    },
    formatSize (bytes) {
      if (bytes === 0) return '0 B'
      const k = 1024
      const sizes = ['B', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
    }
  }
}
</script>

<style scoped>
.conflict-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.conflict-dialog {
  background: var(--floatBgColor);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  width: 90%;
  max-width: 700px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid var(--floatBorderColor);
}

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--editorColor);
}

.close-btn {
  background: none;
  border: none;
  font-size: 28px;
  color: var(--editorColor50);
  cursor: pointer;
  padding: 0;
  width: 30px;
  height: 30px;
  line-height: 1;
}

.close-btn:hover {
  color: var(--editorColor);
}

.dialog-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.description {
  margin: 0 0 20px 0;
  color: var(--editorColor);
  font-size: 14px;
  line-height: 1.6;
}

.file-list {
  border: 1px solid var(--floatBorderColor);
  border-radius: 4px;
  overflow: hidden;
}

.list-header {
  background: var(--itemBgColor);
  padding: 12px 15px;
  border-bottom: 1px solid var(--floatBorderColor);
}

.conflict-item {
  padding: 15px;
  border-bottom: 1px solid var(--floatBorderColor);
}

.conflict-item:last-child {
  border-bottom: none;
}

.conflict-item:hover {
  background: var(--itemHoverBgColor);
}

.checkbox-item {
  display: flex;
  align-items: flex-start;
  cursor: pointer;
  user-select: none;
}

.checkbox-item input[type="checkbox"] {
  margin-right: 12px;
  margin-top: 2px;
  cursor: pointer;
  flex-shrink: 0;
}

.checkbox-label {
  color: var(--editorColor);
  font-size: 14px;
}

.checkbox-label.bold {
  font-weight: 600;
}

.file-info {
  flex: 1;
}

.file-name {
  font-size: 14px;
  color: var(--editorColor);
  margin-bottom: 8px;
  font-weight: 500;
  word-break: break-all;
}

.file-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.detail-item {
  display: flex;
  gap: 8px;
  color: var(--editorColor80);
}

.detail-item .label {
  font-weight: 600;
  min-width: 40px;
}

.detail-item .value {
  color: var(--editorColor);
}

.detail-item .value.muted {
  color: var(--editorColor50);
}

.dialog-footer {
  padding: 20px;
  border-top: 1px solid var(--floatBorderColor);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn {
  padding: 8px 20px;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--itemBgColor);
  color: var(--editorColor);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--itemHoverBgColor);
}

.btn-primary {
  background: var(--themeColor);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}
</style>

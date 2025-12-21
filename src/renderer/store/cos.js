import { ipcRenderer } from 'electron'
import bus from '../bus'

const state = {
  syncInProgress: false,
  syncProgress: {
    type: '',
    file: '',
    percent: 0,
    stats: {
      uploaded: 0,
      downloaded: 0,
      failed: 0,
      total: 0
    }
  },
  lastSyncTime: null,
  syncError: null
}

const getters = {
  isSyncEnabled: (state, getters, rootState) => {
    return rootState.preferences.cosEnabled &&
           rootState.preferences.cosSecretId &&
           rootState.preferences.cosSecretKey &&
           rootState.preferences.cosBucket &&
           rootState.preferences.cosRegion
  },
  syncStatus: (state) => {
    if (state.syncInProgress) {
      return 'syncing'
    } else if (state.syncError) {
      return 'error'
    }
    return 'idle'
  }
}

const mutations = {
  SET_SYNC_IN_PROGRESS (state, inProgress) {
    state.syncInProgress = inProgress
  },
  SET_SYNC_PROGRESS (state, progress) {
    state.syncProgress = progress
  },
  SET_LAST_SYNC_TIME (state, time) {
    state.lastSyncTime = time
  },
  SET_SYNC_ERROR (state, error) {
    state.syncError = error
  },
  CLEAR_SYNC_ERROR (state) {
    state.syncError = null
  }
}

const actions = {
  async START_SYNC ({ commit, rootState }) {
    try {
      commit('SET_SYNC_IN_PROGRESS', true)
      commit('CLEAR_SYNC_ERROR')

      // 获取当前打开的项目目录
      const localDir = rootState.project.projectTree?.pathname

      if (!localDir) {
        throw new Error('请先打开一个文件夹')
      }

      const config = {
        localDir,
        remotePrefix: rootState.preferences.cosRemotePrefix,
        direction: rootState.preferences.cosSyncDirection
      }

      const result = await ipcRenderer.invoke('mt::cos-start-sync', config)

      if (result.success) {
        commit('SET_LAST_SYNC_TIME', new Date())
      } else {
        commit('SET_SYNC_ERROR', result.error)
      }

      return result
    } catch (error) {
      commit('SET_SYNC_ERROR', error.message)
      throw error
    } finally {
      commit('SET_SYNC_IN_PROGRESS', false)
    }
  },

  async CANCEL_SYNC ({ commit }) {
    try {
      await ipcRenderer.invoke('mt::cos-cancel-sync')
      commit('SET_SYNC_IN_PROGRESS', false)
    } catch (error) {
      console.error('Failed to cancel sync:', error)
    }
  },

  LISTEN_FOR_SYNC_EVENTS ({ commit }) {
    ipcRenderer.on('mt::cos-sync-progress', (event, progress) => {
      commit('SET_SYNC_PROGRESS', progress)
    })

    ipcRenderer.on('mt::cos-sync-complete', (event, result) => {
      commit('SET_SYNC_IN_PROGRESS', false)
      if (result.success) {
        commit('SET_LAST_SYNC_TIME', new Date())
        commit('CLEAR_SYNC_ERROR')
      } else {
        commit('SET_SYNC_ERROR', result.error)
      }
    })

    ipcRenderer.on('mt::cos-sync-error', (event, error) => {
      commit('SET_SYNC_IN_PROGRESS', false)
      commit('SET_SYNC_ERROR', error.error || error.message)
    })

    ipcRenderer.on('mt::cos-sync-conflicts', (event, data) => {
      commit('SET_SYNC_IN_PROGRESS', false)
      // 使用全局事件总线触发冲突对话框
      bus.$emit('SHOW_COS_CONFLICT_DIALOG', data)
    })
  },

  async RESOLVE_CONFLICTS ({ commit }, selectedFiles) {
    try {
      commit('SET_SYNC_IN_PROGRESS', true)
      commit('CLEAR_SYNC_ERROR')

      const result = await ipcRenderer.invoke('mt::cos-resolve-conflicts', selectedFiles)

      if (result.success) {
        commit('SET_LAST_SYNC_TIME', new Date())
      } else {
        commit('SET_SYNC_ERROR', result.error)
      }

      return result
    } catch (error) {
      commit('SET_SYNC_ERROR', error.message)
      throw error
    } finally {
      commit('SET_SYNC_IN_PROGRESS', false)
    }
  }
}

const cos = { state, getters, mutations, actions }

export default cos

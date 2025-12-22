<template>
  <div
    v-show="showSideBar"
    class="side-bar"
    ref="sideBar"
    :style="[ !rightColumn ? { 'min-width': '45px' } : {}, { 'width': `${finalSideBarWidth}px` } ]"
  >
    <div class="left-column">
      <ul>
        <li
          v-for="(c, index) of sideBarIcons"
          :key="index"
          @click="handleLeftIconClick(c.name)"
          :class="{ 'active': c.name === rightColumn }"
        >
          <svg :viewBox="c.icon.viewBox">
            <use :xlink:href="c.icon.url"></use>
          </svg>
        </li>
      </ul>
      <ul class="bottom">
        <li
          v-for="(c, index) of sideBarBottomIcons"
          :key="index"
          @click="handleLeftBottomClick(c.name)"
        >
          <svg :viewBox="c.icon.viewBox">
            <use :xlink:href="c.icon.url"></use>
          </svg>
        </li>
      </ul>
    </div>
    <div class="right-column" v-show="rightColumn">
      <tree
        :project-tree="projectTree"
        :opened-files="openedFiles"
        :tabs="tabs"
        v-if="rightColumn === 'files'"
      ></tree>
      <side-bar-search
        v-else-if="rightColumn === 'search'"
      ></side-bar-search>
      <toc
        v-else-if="rightColumn === 'toc'"
      ></toc>
    </div>
    <div class="drag-bar" ref="dragBar" v-show="rightColumn"></div>
  </div>
</template>

<script>
import { sideBarIcons, sideBarBottomIcons } from './help'
import Tree from './tree.vue'
import SideBarSearch from './search.vue'
import Toc from './toc.vue'
import { mapState } from 'vuex'
import notice from '@/services/notification'

export default {
  data () {
    this.sideBarIcons = sideBarIcons
    this.sideBarBottomIcons = sideBarBottomIcons
    return {
      openedFiles: [],
      sideBarViewWidth: 280
    }
  },
  components: {
    Tree,
    SideBarSearch,
    Toc
  },
  computed: {
    ...mapState({
      rightColumn: state => state.layout.rightColumn,
      showSideBar: state => state.layout.showSideBar,
      projectTree: state => state.project.projectTree,
      sideBarWidth: state => state.layout.sideBarWidth,
      tabs: state => state.editor.tabs,
      isSyncEnabled: state =>
        !!state.preferences.cosSecretId &&
        !!state.preferences.cosSecretKey &&
        !!state.preferences.cosBucket &&
        !!state.preferences.cosRegion,
      syncInProgress: state => state.cos && state.cos.syncInProgress,
      syncStatus: state => state.cos ? state.cos.syncStatus : 'idle'
    }),
    finalSideBarWidth () {
      const { showSideBar, rightColumn, sideBarViewWidth } = this
      if (!showSideBar) return 0
      if (rightColumn === '') return 45
      return sideBarViewWidth < 220 ? 220 : sideBarViewWidth
    }
  },
  created () {
    // Initialize COS sync event listeners
    this.$store.dispatch('LISTEN_FOR_SYNC_EVENTS')

    this.$nextTick(() => {
      const dragBar = this.$refs.dragBar
      let startX = 0
      let sideBarWidth = +this.sideBarWidth
      let startWidth = sideBarWidth

      this.sideBarViewWidth = sideBarWidth

      const mouseUpHandler = event => {
        document.removeEventListener('mousemove', mouseMoveHandler, false)
        document.removeEventListener('mouseup', mouseUpHandler, false)
        this.$store.dispatch('CHANGE_SIDE_BAR_WIDTH', sideBarWidth < 220 ? 220 : sideBarWidth)
      }

      const mouseMoveHandler = event => {
        const offset = event.clientX - startX
        sideBarWidth = startWidth + offset
        this.sideBarViewWidth = sideBarWidth
      }

      const mouseDownHandler = event => {
        startX = event.clientX
        startWidth = +this.sideBarWidth
        document.addEventListener('mousemove', mouseMoveHandler, false)
        document.addEventListener('mouseup', mouseUpHandler, false)
      }

      dragBar.addEventListener('mousedown', mouseDownHandler, false)
    })
  },
  methods: {
    handleLeftIconClick (name) {
      if (this.rightColumn === name) {
        this.$store.commit('SET_LAYOUT', { rightColumn: '' })
        this.$store.dispatch('CHANGE_SIDE_BAR_WIDTH', this.finalSideBarWidth)
      } else {
        const needDispatch = this.rightColumn === ''
        this.$store.commit('SET_LAYOUT', { rightColumn: name })
        this.sideBarViewWidth = +this.sideBarWidth
        if (needDispatch) {
          this.$store.dispatch('CHANGE_SIDE_BAR_WIDTH', this.finalSideBarWidth)
        }
      }
    },
    async handleLeftBottomClick (name) {
      if (name === 'settings') {
        this.$store.dispatch('OPEN_SETTING_WINDOW')
      } else if (name === 'sync') {
        if (!this.isSyncEnabled) {
          // this.$message.warning('请先在设置中配置 COS 同步功能')
          notice.notify({
            title: 'COS 同步未配置',
            type: 'warning',
            message: '请先在设置中配置 COS 同步功能'
          })
          // this.$store.dispatch('OPEN_SETTING_WINDOW', 'cos')
          return
        }

        if (this.syncInProgress) {
          // 如果正在同步，取消同步
          await this.$store.dispatch('CANCEL_SYNC')
          // this.$message.info('同步已取消')
          notice.notify({
            time: 3000,
            title: '同步已取消',
            type: 'info',
            message: '同步已取消'
          })
        } else {
          // 开始同步
          try {
            notice.notify({
              time: 0,
              title: '同步开始',
              type: 'info',
              message: 'COS 同步已开始，请稍候...'
            })
            const result = await this.$store.dispatch('START_SYNC')
            if (result.success) {
              const { stats } = result
              notice.clear()
              notice.notify({
                time: 3000,
                title: '同步完成',
                type: 'success',
                message: `同步完成: 上传 ${stats.uploaded} 个文件，下载 ${stats.downloaded} 个文件。`
              })
            } else {
              notice.notify({
                time: 3000,
                title: '同步失败',
                type: 'error',
                message: '同步过程中发生错误: ' + result.message
              })
            }
          } catch (error) {
            console.error('Sync error:', error)
            notice.notify({
              time: 1000,
              title: '同步失败',
              type: 'error',
              message: '同步失败: ' + error.message
            })
          }
        }
      }
    }
  }
}
</script>

<style scoped>
  .side-bar {
    display: flex;
    flex-shrink: 0;
    flex-grow: 0;
    width: 280px;
    height: 100vh;
    min-width: 220px;
    position: relative;
    color: var(--sideBarColor);
    user-select: none;
    background: var(--sideBarBgColor);
    border-right: 1px solid var(--itemBgColor);
    & .left-column {
      & svg {
        fill: var(--iconColor);
      }
    }
  }

  .left-column {
    height: 100%;
    width: 45px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding-top: 40px;
    box-sizing: border-box;
    & > ul {
      opacity: 1;
    }
  }

  .left-column ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    & > li {
      width: 45px;
      height: 45px;
      margin: 0;
      padding: 0;
      display: flex;
      justify-content: space-around;
      align-items: center;
      cursor: pointer;
      & > svg {
        width: 18px;
        height: 18px;
        fill: var(--sideBarIconColor);
        opacity: 1;
        transition: transform .25s ease-in-out;
      }
      &.active > svg {
        fill: var(--themeColor);
      }
    }
  }

  .side-bar:hover .left-column ul li svg {
    opacity: 1;
  }
  .right-column {
    flex: 1;
    width: calc(100% - 50px);
    overflow: hidden;
  }
  .drag-bar {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    height: 100%;
    width: 3px;
    cursor: col-resize;
    &:hover {
      border-right: 2px solid var(--iconColor);
    }
  }
</style>

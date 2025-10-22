<template>
  <div class="user-page">
    <div
      v-if="userDetail && user"
      class="left"
      :class="setAnimationClass('animate__fadeInLeft')"
      :style="{ backgroundImage: `url(${getImgUrl(user.backgroundUrl)})` }"
    >
      <div class="page">
        <div class="user-name">
          <span>{{ user.nickname }}</span>
          <span v-if="currentLoginType" class="login-type">{{
            t('login.title.' + currentLoginType)
          }}</span>
        </div>
        <div class="user-info">
          <n-avatar round :size="50" :src="getImgUrl(user.avatarUrl, '50y50')" />
          <div class="user-info-list">
            <div class="user-info-item">
              <div class="label">{{ userDetail.profile.followeds }}</div>
              <div>{{ t('user.profile.followers') }}</div>
            </div>
            <div class="user-info-item" @click="showFollowList">
              <div class="label">{{ userDetail.profile.follows }}</div>
              <div>{{ t('user.profile.following') }}</div>
            </div>
            <div class="user-info-item">
              <div class="label">{{ userDetail.level }}</div>
              <div>{{ t('user.profile.level') }}</div>
            </div>
          </div>
        </div>
        <div class="uesr-signature">{{ userDetail.profile.signature }}</div>
        <div class="play-list" :class="setAnimationClass('animate__fadeInLeft')">
          <div class="tab-container">
            <n-tabs v-model:value="currentTab" type="segment" animated>
              <n-tab v-for="tab in tabs" :key="tab.key" :name="tab.key" :tab="t(tab.label)">
              </n-tab>
            </n-tabs>
          </div>
          <n-scrollbar>
            <div class="mt-4">
              <button
                class="play-list-item"
                @click="goToImportPlaylist"
                v-if="isElectron && currentTab === 'created'"
              >
                <div class="play-list-item-img"><i class="icon iconfont ri-add-line"></i></div>
                <div class="play-list-item-info">
                  <div class="play-list-item-name">
                    {{ t('comp.playlist.import.button') }}
                  </div>
                </div>
              </button>
              <div
                v-for="(item, index) in currentList"
                :key="index"
                class="play-list-item"
                @click="handleItemClick(item)"
              >
                <n-image
                  :src="getImgUrl(getCoverUrl(item), '50y50')"
                  class="play-list-item-img"
                  lazy
                  preview-disabled
                />
                <div class="play-list-item-info">
                  <div class="play-list-item-name">
                    <n-ellipsis :line-clamp="1">{{ item.name }}</n-ellipsis>
                  </div>
                  <div class="play-list-item-count">
                    {{ getItemDescription(item) }}
                  </div>
                </div>
              </div>
              <div class="pb-20"></div>
              <play-bottom />
            </div>
          </n-scrollbar>
        </div>
      </div>
    </div>
    <div
      v-if="!isMobile"
      v-loading="infoLoading"
      class="right"
      :class="setAnimationClass('animate__fadeInRight')"
    >
      <div class="title">{{ t('user.ranking.title') }}</div>
      <div class="record-list">
        <n-scrollbar>
          <div
            v-for="(item, index) in recordList"
            :key="item.id"
            class="record-item"
            :class="setAnimationClass('animate__bounceInUp')"
            :style="setAnimationDelay(index, 25)"
          >
            <div class="play-score">
              {{ index + 1 }}
            </div>
            <song-item class="song-item" :item="item" mini @play="handlePlay" />
          </div>
          <play-bottom />
        </n-scrollbar>
      </div>
    </div>
    <!-- 未登录时显示登录组件 -->
    <div
      v-if="!isLoggedIn && isMobile"
      class="login-container"
      :class="setAnimationClass('animate__fadeIn')"
    >
      <login-component @login-success="handleLoginSuccess" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useMessage } from 'naive-ui';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { getListDetail } from '@/api/list';
import { getUserAlbumSublist, getUserDetail, getUserPlaylist, getUserRecord } from '@/api/user';
import { navigateToMusicList } from '@/components/common/MusicListNavigator';
import PlayBottom from '@/components/common/PlayBottom.vue';
import SongItem from '@/components/common/SongItem.vue';
import { usePlayerStore } from '@/store/modules/player';
import { useUserStore } from '@/store/modules/user';
import type { Playlist } from '@/types/listDetail';
import type { IUserDetail } from '@/types/user';
import { getImgUrl, isElectron, isMobile, setAnimationClass, setAnimationDelay } from '@/utils';
import { checkLoginStatus as checkAuthStatus } from '@/utils/auth';
import LoginComponent from '@/views/login/index.vue';

defineOptions({
  name: 'User'
});

const { t } = useI18n();
const userStore = useUserStore();
const playerStore = usePlayerStore();
const router = useRouter();
const userDetail = ref<IUserDetail>();
const playList = ref<any[]>([]);
const recordList = ref();
const infoLoading = ref(false);
const mounted = ref(true);
const list = ref<Playlist>();
const listLoading = ref(false);
const message = useMessage();

// Tab 相关
const tabs = [
  { key: 'created', label: 'user.tabs.created' },
  { key: 'favorite', label: 'user.tabs.favorite' },
  { key: 'album', label: 'user.tabs.album' }
];
const currentTab = ref('created');
const albumList = ref<any[]>([]);

const user = computed(() => userStore.user);

// 创建的歌单（当前用户创建的）
const createdPlaylists = computed(() => {
  if (!user.value) return [];
  return playList.value.filter((item) => item.creator?.userId === user.value!.userId);
});

// 收藏的歌单（非当前用户创建的）
const favoritePlaylists = computed(() => {
  if (!user.value) return [];
  return playList.value.filter((item) => item.creator?.userId !== user.value!.userId);
});

// 当前显示的列表（根据 tab 切换）
const currentList = computed(() => {
  switch (currentTab.value) {
    case 'created':
      return createdPlaylists.value;
    case 'favorite':
      return favoritePlaylists.value;
    case 'album':
      return albumList.value;
    default:
      return [];
  }
});

// 获取封面图片 URL
const getCoverUrl = (item: any) => {
  return item.coverImgUrl || item.picUrl || '';
};

// 获取列表项描述
const getItemDescription = (item: any) => {
  if (currentTab.value === 'album') {
    // 专辑：显示艺术家和歌曲数量
    const artist = item.artist?.name || '';
    const size = item.size ? ` · ${item.size}首` : '';
    return `${artist}${size}`;
  } else {
    // 歌单：显示曲目数和播放量
    return `${t('user.playlist.trackCount', { count: item.trackCount })}，${t('user.playlist.playCount', { count: item.playCount })}`;
  }
};

// 统一处理列表项点击
const handleItemClick = (item: any) => {
  if (currentTab.value === 'album') {
    openAlbum(item);
  } else {
    openPlaylist(item);
  }
};

const goToImportPlaylist = () => {
  router.push('/playlist/import');
};

onBeforeUnmount(() => {
  mounted.value = false;
});

// 检查登录状态
const checkLoginStatus = () => {
  // 优先使用 userStore 中的状态
  if (userStore.user && userStore.loginType) {
    return true;
  }

  // 如果 store 中没有数据，尝试从 localStorage 恢复
  const loginInfo = checkAuthStatus();

  if (!loginInfo.isLoggedIn) {
    !isMobile.value && router.push('/login');
    return false;
  }

  // 恢复用户数据和登录类型到 store
  if (!userStore.user && loginInfo.user) {
    userStore.setUser(loginInfo.user);
  }

  if (!userStore.loginType && loginInfo.loginType) {
    userStore.setLoginType(loginInfo.loginType);
  }

  return true;
};

const loadPage = async () => {
  if (!mounted.value) return;

  // 检查登录状态
  if (!checkLoginStatus()) return;

  await loadData();
};

const loadData = async () => {
  try {
    infoLoading.value = true;

    if (!user.value) {
      console.warn('用户数据不存在，尝试重新获取');
      // 可以尝试重新获取用户数据
      return;
    }

    // 使用 Promise.all 并行请求提高效率
    const [userDetailRes, playlistRes, recordRes] = await Promise.all([
      getUserDetail(user.value.userId),
      getUserPlaylist(user.value.userId),
      getUserRecord(user.value.userId)
    ]);

    if (!mounted.value) return;

    userDetail.value = userDetailRes.data;
    playList.value = playlistRes.data.playlist;
    recordList.value = recordRes.data.allData.map((item: any) => ({
      ...item,
      ...item.song,
      picUrl: item.song.al.picUrl
    }));
  } catch (error: any) {
    console.error('加载用户页面失败:', error);
    if (error.response?.status === 401) {
      userStore.handleLogout();
      router.push('/login');
    } else {
      // 添加更多错误处理和重试逻辑
      message.error(t('user.message.loadFailed'));
    }
  } finally {
    if (mounted.value) {
      infoLoading.value = false;
    }
  }
};

// 加载专辑列表
const loadAlbumList = async () => {
  try {
    infoLoading.value = true;
    const res = await getUserAlbumSublist({ limit: 100, offset: 0 });
    if (!mounted.value) return;
    albumList.value = res.data.data || [];
  } catch (error: any) {
    console.error('加载专辑列表失败:', error);
    message.error('加载专辑列表失败');
  } finally {
    if (mounted.value) {
      infoLoading.value = false;
    }
  }
};

// 监听路由变化
watch(
  () => router.currentRoute.value.path,
  (newPath) => {
    console.log('newPath', newPath);
    if (newPath === '/user') {
      checkLoginStatus();
      loadData();
    }
  }
);

// 监听用户状态变化
watch(
  () => userStore.user,
  (newUser) => {
    if (!mounted.value) return;
    if (newUser) {
      checkLoginStatus();
      loadPage();
    }
  }
);

// 监听 tab 切换
watch(currentTab, async (newTab) => {
  if (newTab === 'album') {
    // 刷新收藏专辑列表到 store
    await userStore.initializeCollectedAlbums();
    // 如果本地列表为空，则加载
    if (albumList.value.length === 0) {
      loadAlbumList();
    }
  }
});

// 页面挂载时检查登录状态
onMounted(() => {
  checkLoginStatus() && loadData();
});

// 替换显示歌单的方法
const openPlaylist = (item: any) => {
  listLoading.value = true;

  getListDetail(item.id).then((res) => {
    list.value = res.data.playlist;
    listLoading.value = false;

    navigateToMusicList(router, {
      id: item.id,
      type: 'playlist',
      name: item.name,
      songList: res.data.playlist.tracks || [],
      listInfo: res.data.playlist,
      canRemove: true // 保留可移除功能
    });
  });
};

// 打开专辑
const openAlbum = async (item: any) => {
  // 使用专辑 API 获取专辑详情
  try {
    listLoading.value = true;
    const { getAlbumDetail } = await import('@/api/music');
    const res = await getAlbumDetail(item.id.toString());

    if (res.data?.album && res.data?.songs) {
      const albumData = res.data.album;
      const songs = res.data.songs.map((item) => ({
        ...item,
        picUrl: albumData.picUrl
      }));

      navigateToMusicList(router, {
        id: item.id,
        type: 'album',
        name: albumData.name,
        songList: songs,
        listInfo: albumData,
        canRemove: false // 专辑不支持移除歌曲
      });
    }
  } catch (error) {
    console.error('加载专辑失败:', error);
    message.error('加载专辑失败');
  } finally {
    listLoading.value = false;
  }
};

const handlePlay = () => {
  const tracks = recordList.value || [];
  playerStore.setPlayList(tracks);
};

// 显示关注列表
const showFollowList = () => {
  if (!user.value) return;
  router.push('/user/follows');
};

// // 显示粉丝列表
// const showFollowerList = () => {
//   if (!user.value) return;
//   router.push('/user/followers');
// };

const handleLoginSuccess = () => {
  // 处理登录成功后的逻辑
  checkLoginStatus();
  loadData();
};

const isLoggedIn = computed(() => userStore.user);
const currentLoginType = computed(() => userStore.loginType);
</script>

<style lang="scss" scoped>
.user-page {
  @apply flex h-full;
  .left {
    max-width: 600px;
    @apply flex-1 rounded-2xl overflow-hidden relative bg-no-repeat h-full;
    @apply bg-gray-900 dark:bg-gray-800;

    .page {
      @apply p-4 w-full z-10 flex flex-col h-full;
      @apply bg-black bg-opacity-40;
    }
    .title {
      @apply text-lg font-bold flex items-center justify-between;
      @apply text-gray-900 dark:text-white;
    }
    .user-name {
      @apply text-xl font-bold mb-4 flex justify-between;
      @apply text-white text-opacity-70;
    }

    .uesr-signature {
      @apply mt-4;
      @apply text-white text-opacity-70;
    }

    .user-info {
      @apply flex items-center;
      &-list {
        @apply flex justify-around w-2/5 text-center;
        @apply text-white text-opacity-70;

        .label {
          @apply text-xl font-bold text-white;
        }
      }

      &-item {
        @apply cursor-pointer;
      }
    }
  }

  .right {
    @apply flex-1 ml-4 overflow-hidden h-full;

    .record-list {
      @apply rounded-2xl;
      @apply bg-light dark:bg-black;
      height: calc(100% - 100px);

      .record-item {
        @apply flex items-center px-2 mb-2 rounded-2xl bg-light-100 dark:bg-dark-100;
      }

      .song-item {
        @apply flex-1;
      }

      .play-score {
        @apply text-gray-500 dark:text-gray-400 mr-2 text-lg w-10 h-10 rounded-full flex items-center justify-center;
      }
    }

    .title {
      @apply text-xl font-bold m-4;
      @apply text-gray-900 dark:text-white;
    }
  }
}

.play-list {
  @apply mt-4 py-4 px-2 rounded-xl flex-1 overflow-hidden;
  @apply bg-light dark:bg-black;

  &-title {
    @apply text-lg;
    @apply text-gray-900 dark:text-white;
  }

  &-item {
    @apply flex items-center px-2 py-2 rounded-xl cursor-pointer w-full;
    @apply transition-all duration-200;
    @apply hover:bg-light-200 dark:hover:bg-dark-200;

    &-img {
      @apply flex items-center justify-center rounded-xl text-[40px] w-[60px] h-[60px] bg-light-300 dark:bg-dark-300;
      .iconfont {
        @apply text-[40px];
      }
    }

    &-info {
      @apply ml-2 flex-1;
    }

    &-name {
      @apply text-gray-900 dark:text-white text-base flex items-center gap-2;

      .playlist-creator-tag {
        @apply inline-flex items-center justify-center px-2 rounded-full text-xs;
        @apply bg-light-300 text-primary dark:bg-dark-300 dark:text-white;
        @apply border border-primary/20 dark:border-primary/30;
        height: 18px;
        font-size: 10px;
        font-weight: 500;
        min-width: 60px;
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
      }
    }

    &-count {
      @apply text-gray-500 dark:text-gray-400;
    }
  }
}

.login-type {
  @apply text-sm text-green-500 dark:text-green-400;
}

.mobile {
  .user-page {
    @apply px-4;
  }

  .login-container {
    @apply flex justify-center items-center h-full w-full;
  }
}

:deep(.n-tabs-rail) {
  @apply rounded-xl overflow-hidden !important;
  .n-tabs-capsule {
    @apply rounded-xl !important;
  }
}
</style>

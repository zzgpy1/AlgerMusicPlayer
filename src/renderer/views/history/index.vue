<template>
  <div class="history-page">
    <div class="title-wrapper" :class="setAnimationClass('animate__fadeInRight')">
      <div class="title">{{ t('history.title') }}</div>
      <n-button
        secondary
        type="primary"
        size="small"
        class="heatmap-btn"
        @click="handleNavigateToHeatmap"
      >
        <template #icon>
          <i class="iconfont ri-calendar-2-line"></i>
        </template>
        {{ t('history.heatmapTitle') }}
      </n-button>
    </div>
    <!-- 第一级Tab: 歌曲/歌单/专辑 -->
    <div class="category-tabs-wrapper" :class="setAnimationClass('animate__fadeInRight')">
      <n-tabs
        v-model:value="currentCategory"
        type="segment"
        animated
        size="large"
        @update:value="handleCategoryChange"
      >
        <n-tab name="songs" :tab="t('history.categoryTabs.songs')"></n-tab>
        <n-tab name="playlists" :tab="t('history.categoryTabs.playlists')"></n-tab>
        <n-tab name="albums" :tab="t('history.categoryTabs.albums')"></n-tab>
      </n-tabs>
    </div>
    <!-- 第二级Tab: 本地/云端 -->
    <div class="tabs-wrapper" :class="setAnimationClass('animate__fadeInRight')">
      <n-tabs
        v-model:value="currentTab"
        type="segment"
        animated
        @update:value="handleTabChange"
        size="small"
      >
        <n-tab name="local" :tab="t('history.tabs.local')"></n-tab>
        <n-tab name="cloud" :tab="t('history.tabs.cloud')"></n-tab>
      </n-tabs>
    </div>
    <n-scrollbar ref="scrollbarRef" :size="100" @scroll="handleScroll">
      <div class="history-list-content" :class="setAnimationClass('animate__bounceInLeft')">
        <!-- 歌曲列表 -->
        <template v-if="currentCategory === 'songs'">
          <div
            v-for="(item, index) in displayList"
            :key="item.id"
            class="history-item"
            :class="setAnimationClass('animate__bounceInRight')"
            :style="setAnimationDelay(index, 30)"
          >
            <song-item class="history-item-content" :item="item" @play="handlePlay" />
            <div class="history-item-count min-w-[60px]" v-show="currentTab === 'local'">
              {{ t('history.playCount', { count: item.count }) }}
            </div>
            <div class="history-item-delete" v-show="currentTab === 'local'">
              <i class="iconfont icon-close" @click="handleDelMusic(item)"></i>
            </div>
          </div>
        </template>

        <!-- 歌单列表 -->
        <template v-if="currentCategory === 'playlists'">
          <playlist-item
            v-for="(item, index) in displayList"
            :key="item.id"
            :item="item"
            :show-count="currentTab === 'local'"
            :show-delete="currentTab === 'local'"
            :class="setAnimationClass('animate__bounceInRight')"
            :style="setAnimationDelay(index, 30)"
            @click="handlePlaylistClick(item)"
            @delete="handleDelPlaylist(item)"
          />
        </template>

        <!-- 专辑列表 -->
        <template v-if="currentCategory === 'albums'">
          <album-item
            v-for="(item, index) in displayList"
            :key="item.id"
            :item="item"
            :show-count="currentTab === 'local'"
            :show-delete="currentTab === 'local'"
            :class="setAnimationClass('animate__bounceInRight')"
            :style="setAnimationDelay(index, 30)"
            @click="handleAlbumClick(item)"
            @delete="handleDelAlbum(item)"
          />
        </template>

        <div v-if="displayList.length === 0 && !loading" class="no-data">
          {{ t('history.noData') }}
        </div>

        <div v-if="loading" class="loading-wrapper">
          <n-spin size="large" />
        </div>

        <div v-if="noMore && displayList.length > 0" class="no-more-tip">
          {{ t('common.noMore') }}
        </div>
      </div>
    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { useMessage } from 'naive-ui';
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { processBilibiliVideos } from '@/api/bilibili';
import { getListDetail } from '@/api/list';
import { getAlbumDetail } from '@/api/music';
import { getMusicDetail } from '@/api/music';
import { getRecentAlbums, getRecentPlaylists, getRecentSongs } from '@/api/user';
import AlbumItem from '@/components/common/AlbumItem.vue';
import { navigateToMusicList } from '@/components/common/MusicListNavigator';
import PlaylistItem from '@/components/common/PlaylistItem.vue';
import SongItem from '@/components/common/SongItem.vue';
import { useAlbumHistory } from '@/hooks/AlbumHistoryHook';
import { useMusicHistory } from '@/hooks/MusicHistoryHook';
import { usePlaylistHistory } from '@/hooks/PlaylistHistoryHook';
import { usePlayerStore } from '@/store/modules/player';
import { useUserStore } from '@/store/modules/user';
import type { SongResult } from '@/types/music';
import { setAnimationClass, setAnimationDelay } from '@/utils';

// 扩展历史记录类型以包含 playTime
interface HistoryRecord extends Partial<SongResult> {
  id: string | number;
  playTime?: number;
  score?: number;
  source?: 'netease' | 'bilibili';
  count?: number;
  recordSource?: 'local' | 'cloud';
  sources?: ('local' | 'cloud')[];
  bilibiliData?: {
    bvid: string;
    cid: number;
  };
}

const { t } = useI18n();
const message = useMessage();
const router = useRouter();
const { delMusic, musicList } = useMusicHistory();
const { delPlaylist, playlistList } = usePlaylistHistory();
const { delAlbum, albumList } = useAlbumHistory();
const userStore = useUserStore();
const scrollbarRef = ref();
const loading = ref(false);
const noMore = ref(false);
const displayList = ref<any[]>([]);
const playerStore = usePlayerStore();
const hasLoaded = ref(false);
const currentCategory = ref<'songs' | 'playlists' | 'albums'>('songs');
const currentTab = ref<'local' | 'cloud'>('local');
const cloudRecords = ref<HistoryRecord[]>([]);
const cloudPlaylists = ref<any[]>([]);
const cloudAlbums = ref<any[]>([]);

// 无限滚动相关配置
const pageSize = 100;
const currentPage = ref(1);

// 获取云端播放记录
const getCloudRecords = async () => {
  if (!userStore.user?.userId || userStore.loginType !== 'cookie') {
    message.warning(t('history.needLogin'));
    return [];
  }

  try {
    const res = await getRecentSongs(1000);
    if (res.data?.data?.list) {
      return res.data.data.list.map((item: any) => ({
        id: item.data?.id,
        playTime: item.playTime,
        source: 'netease',
        count: 1,
        data: item.data
      }));
    }
    return [];
  } catch (error: any) {
    console.error(t('history.getCloudRecordFailed'), error);
    if (error?.response?.status !== 301 && error?.response?.data?.code !== -2) {
      message.error(t('history.getCloudRecordFailed'));
    }
    return [];
  }
};

// 获取云端歌单播放记录
const getCloudPlaylists = async () => {
  if (!userStore.user?.userId || userStore.loginType !== 'cookie') {
    message.warning(t('history.needLogin'));
    return [];
  }

  try {
    const res = await getRecentPlaylists(100);
    if (res.data?.data?.list) {
      return res.data.data.list.map((item: any) => ({
        id: item.data?.id,
        name: item.data?.name,
        coverImgUrl: item.data?.coverImgUrl,
        picUrl: item.data?.picUrl,
        trackCount: item.data?.trackCount,
        playCount: item.data?.playCount,
        creator: item.data?.creator,
        playTime: item.playTime
      }));
    }
    return [];
  } catch (error: any) {
    console.error(t('history.getCloudRecordFailed'), error);
    if (error?.response?.status !== 301 && error?.response?.data?.code !== -2) {
      message.error(t('history.getCloudRecordFailed'));
    }
    return [];
  }
};

// 获取云端专辑播放记录
const getCloudAlbums = async () => {
  if (!userStore.user?.userId || userStore.loginType !== 'cookie') {
    message.warning(t('history.needLogin'));
    return [];
  }

  try {
    const res = await getRecentAlbums(100);
    if (res.data?.data?.list) {
      return res.data.data.list.map((item: any) => ({
        id: item.data?.id,
        name: item.data?.name,
        picUrl: item.data?.picUrl,
        size: item.data?.size,
        artist: item.data?.artist,
        playTime: item.playTime
      }));
    }
    return [];
  } catch (error: any) {
    console.error(t('history.getCloudRecordFailed'), error);
    if (error?.response?.status !== 301 && error?.response?.data?.code !== -2) {
      message.error(t('history.getCloudRecordFailed'));
    }
    return [];
  }
};

// 根据当前分类和tab获取要显示的列表
const getCurrentList = (): any[] => {
  if (currentCategory.value === 'songs') {
    switch (currentTab.value) {
      case 'local':
        return musicList.value;
      case 'cloud':
        return cloudRecords.value.filter((item) => item.id);
    }
  } else if (currentCategory.value === 'playlists') {
    switch (currentTab.value) {
      case 'local':
        return playlistList.value;
      case 'cloud':
        return cloudPlaylists.value;
    }
  } else if (currentCategory.value === 'albums') {
    switch (currentTab.value) {
      case 'local':
        return albumList.value;
      case 'cloud':
        return cloudAlbums.value;
    }
  }
  return [];
};

// 处理分类切换
const handleCategoryChange = async (value: 'songs' | 'playlists' | 'albums') => {
  currentCategory.value = value;
  currentPage.value = 1;
  noMore.value = false;
  displayList.value = [];

  // 如果切换到云端，且还没有加载对应的云端数据，则加载
  if (currentTab.value === 'cloud') {
    loading.value = true;
    if (value === 'songs' && cloudRecords.value.length === 0) {
      cloudRecords.value = await getCloudRecords();
    } else if (value === 'playlists' && cloudPlaylists.value.length === 0) {
      cloudPlaylists.value = await getCloudPlaylists();
    } else if (value === 'albums' && cloudAlbums.value.length === 0) {
      cloudAlbums.value = await getCloudAlbums();
    }
    loading.value = false;
  }

  await loadHistoryData();
};

// 处理歌单点击
const handlePlaylistClick = async (item: any) => {
  try {
    const res = await getListDetail(item.id);
    if (res.data?.playlist) {
      navigateToMusicList(router, {
        id: item.id,
        type: 'playlist',
        name: item.name,
        songList: res.data.playlist.tracks || [],
        listInfo: res.data.playlist,
        canRemove: false
      });
    }
  } catch (error) {
    console.error('打开歌单失败:', error);
    message.error('打开歌单失败');
  }
};

// 处理专辑点击
const handleAlbumClick = async (item: any) => {
  try {
    const res = await getAlbumDetail(item.id.toString());
    if (res.data?.album && res.data?.songs) {
      const albumData = res.data.album;
      const songs = res.data.songs.map((song: any) => ({
        ...song,
        picUrl: albumData.picUrl
      }));

      navigateToMusicList(router, {
        id: item.id,
        type: 'album',
        name: albumData.name,
        songList: songs,
        listInfo: albumData,
        canRemove: false
      });
    }
  } catch (error) {
    console.error('打开专辑失败:', error);
    message.error('打开专辑失败');
  }
};

// 删除歌单记录
const handleDelPlaylist = (item: any) => {
  delPlaylist(item);
  displayList.value = displayList.value.filter((playlist) => playlist.id !== item.id);
};

// 删除专辑记录
const handleDelAlbum = (item: any) => {
  delAlbum(item);
  displayList.value = displayList.value.filter((album) => album.id !== item.id);
};

// 加载历史数据（根据当前分类）
const loadHistoryData = async () => {
  const currentList = getCurrentList();
  if (currentList.length === 0) {
    displayList.value = [];
    return;
  }

  loading.value = true;
  try {
    const startIndex = (currentPage.value - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const currentPageItems = currentList.slice(startIndex, endIndex);

    // 根据分类处理不同的数据
    if (currentCategory.value === 'songs') {
      // 处理歌曲数据
      const neteaseItems = currentPageItems.filter((item) => item.source !== 'bilibili');
      const bilibiliItems = currentPageItems.filter((item) => item.source === 'bilibili');

      let neteaseSongs: SongResult[] = [];
      if (neteaseItems.length > 0) {
        const currentIds = neteaseItems.map((item) => item.id as number);
        const res = await getMusicDetail(currentIds);
        if (res.data.songs) {
          neteaseSongs = res.data.songs.map((song: SongResult) => {
            const historyItem = neteaseItems.find((item) => item.id === song.id);
            return {
              ...song,
              picUrl: song.al?.picUrl || '',
              count: historyItem?.count || 0,
              source: 'netease'
            };
          });
        }
      }

      const bilibiliIds = bilibiliItems
        .map((item) => `${item.bilibiliData?.bvid}--1--${item.bilibiliData?.cid}`)
        .filter((id) => id && !id.includes('undefined'));

      const bilibiliSongs = await processBilibiliVideos(bilibiliIds);

      bilibiliSongs.forEach((song) => {
        const historyItem = bilibiliItems.find(
          (item) =>
            item.bilibiliData?.bvid === song.bilibiliData?.bvid &&
            item.bilibiliData?.cid === song.bilibiliData?.cid
        );
        if (historyItem) {
          song.count = historyItem.count || 0;
        }
      });

      const newSongs = currentPageItems
        .map((item) => {
          if (item.source === 'bilibili') {
            return bilibiliSongs.find(
              (song) =>
                song.bilibiliData?.bvid === item.bilibiliData?.bvid &&
                song.bilibiliData?.cid === item.bilibiliData?.cid
            );
          }
          return neteaseSongs.find((song) => song.id === item.id);
        })
        .filter((song): song is SongResult => !!song);

      if (currentPage.value === 1) {
        displayList.value = newSongs;
      } else {
        displayList.value = [...displayList.value, ...newSongs];
      }
    } else {
      // 处理歌单和专辑数据（直接显示，不需要额外请求）
      if (currentPage.value === 1) {
        displayList.value = currentPageItems;
      } else {
        displayList.value = [...displayList.value, ...currentPageItems];
      }
    }

    const totalLength = getCurrentList().length;
    noMore.value = displayList.value.length >= totalLength;
  } catch (error) {
    console.error(t('history.getHistoryFailed'), error);
  } finally {
    loading.value = false;
  }
};

// 处理滚动事件
const handleScroll = (e: any) => {
  const { scrollTop, scrollHeight, offsetHeight } = e.target;
  const threshold = 100;

  if (!loading.value && !noMore.value && scrollHeight - (scrollTop + offsetHeight) < threshold) {
    currentPage.value++;
    loadHistoryData();
  }
};

// 播放全部
const handlePlay = () => {
  playerStore.setPlayList(displayList.value);
};

// 处理 tab 切换
const handleTabChange = async (value: 'local' | 'cloud') => {
  currentTab.value = value;
  currentPage.value = 1;
  noMore.value = false;
  displayList.value = [];

  // 如果切换到云端，且还没有加载对应的云端数据，则加载
  if (value === 'cloud') {
    loading.value = true;
    if (currentCategory.value === 'songs' && cloudRecords.value.length === 0) {
      cloudRecords.value = await getCloudRecords();
    } else if (currentCategory.value === 'playlists' && cloudPlaylists.value.length === 0) {
      cloudPlaylists.value = await getCloudPlaylists();
    } else if (currentCategory.value === 'albums' && cloudAlbums.value.length === 0) {
      cloudAlbums.value = await getCloudAlbums();
    }
    loading.value = false;
  }

  await loadHistoryData();
};

onMounted(async () => {
  if (!hasLoaded.value) {
    await loadHistoryData();
    hasLoaded.value = true;
  }
});

// 监听历史列表变化，变化时重置并重新加载
watch(
  [musicList, playlistList, albumList],
  async () => {
    if (hasLoaded.value) {
      currentPage.value = 1;
      noMore.value = false;
      await loadHistoryData();
    }
  },
  { deep: true }
);

// 重写删除方法，需要同时更新 displayList
const handleDelMusic = async (item: SongResult) => {
  delMusic(item);
  musicList.value = musicList.value.filter((music) => music.id !== item.id);
  displayList.value = displayList.value.filter((music) => music.id !== item.id);
};

// 跳转到热力图页面
const handleNavigateToHeatmap = () => {
  router.push('/heatmap');
};
</script>

<style scoped lang="scss">
.history-page {
  @apply h-full w-full pt-2;
  @apply bg-light dark:bg-black;

  .title-wrapper {
    @apply flex items-center justify-between pb-2 px-4;

    .title {
      @apply text-xl font-bold;
      @apply text-gray-900 dark:text-white;
    }

    .heatmap-btn {
      @apply rounded-full px-4 h-8;
      @apply transition-all duration-300;
      @apply hover:scale-105;

      .iconfont {
        @apply text-base;
      }
    }
  }

  .category-tabs-wrapper {
    @apply px-4 mb-2;
  }

  .tabs-wrapper {
    @apply px-4;
  }

  .history-list-content {
    @apply mt-2 pb-28 px-4;
    .history-item {
      @apply flex items-center justify-between;
      &-content {
        @apply flex-1 bg-light-100 dark:bg-dark-100 hover:bg-light-200 dark:hover:bg-dark-200 transition-all;
      }
      &-count {
        @apply px-4 text-lg text-center;
        @apply text-gray-600 dark:text-gray-400;
      }
      &-delete {
        @apply cursor-pointer rounded-full border-2 w-8 h-8 flex justify-center items-center;
        @apply border-gray-400 dark:border-gray-600;
        @apply text-gray-600 dark:text-gray-400;
        @apply hover:border-red-500 hover:text-red-500;
      }
    }
  }
}

.loading-wrapper {
  @apply flex justify-center items-center py-8;
}

.no-more-tip {
  @apply text-center py-4 text-sm;
  @apply text-gray-500 dark:text-gray-400;
}

.no-data {
  @apply text-center py-8 text-gray-500 dark:text-gray-400;
}

:deep(.n-tabs-rail) {
  @apply rounded-xl overflow-hidden !important;
  .n-tabs-capsule {
    @apply rounded-xl !important;
  }
}

.category-tabs-wrapper {
  :deep(.n-tabs-rail) {
    @apply rounded-xl overflow-hidden bg-white dark:bg-dark-300 !important;
    .n-tabs-capsule {
      @apply rounded-xl bg-green-500 dark:bg-green-600 !important;
    }
    .n-tabs-tab--active {
      @apply text-white !important;
    }
  }
}
</style>

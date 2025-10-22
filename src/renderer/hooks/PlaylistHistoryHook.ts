import { useLocalStorage } from '@vueuse/core';
import { ref, watch } from 'vue';

// 歌单历史记录类型
export interface PlaylistHistoryItem {
  id: number;
  name: string;
  coverImgUrl?: string;
  picUrl?: string; // 兼容字段
  trackCount?: number;
  playCount?: number;
  creator?: {
    nickname: string;
    userId: number;
  };
  count?: number; // 播放次数
  lastPlayTime?: number; // 最后播放时间
}

export const usePlaylistHistory = () => {
  const playlistHistory = useLocalStorage<PlaylistHistoryItem[]>('playlistHistory', []);

  const addPlaylist = (playlist: PlaylistHistoryItem) => {
    const index = playlistHistory.value.findIndex((item) => item.id === playlist.id);
    const now = Date.now();

    if (index !== -1) {
      // 如果已存在，更新播放次数和时间，并移到最前面
      playlistHistory.value[index].count = (playlistHistory.value[index].count || 0) + 1;
      playlistHistory.value[index].lastPlayTime = now;
      playlistHistory.value.unshift(playlistHistory.value.splice(index, 1)[0]);
    } else {
      // 如果不存在，添加新记录
      playlistHistory.value.unshift({
        ...playlist,
        count: 1,
        lastPlayTime: now
      });
    }
  };

  const delPlaylist = (playlist: PlaylistHistoryItem) => {
    const index = playlistHistory.value.findIndex((item) => item.id === playlist.id);
    if (index !== -1) {
      playlistHistory.value.splice(index, 1);
    }
  };

  const playlistList = ref(playlistHistory.value);

  watch(
    () => playlistHistory.value,
    () => {
      playlistList.value = playlistHistory.value;
    },
    { deep: true }
  );

  return {
    playlistHistory,
    playlistList,
    addPlaylist,
    delPlaylist
  };
};

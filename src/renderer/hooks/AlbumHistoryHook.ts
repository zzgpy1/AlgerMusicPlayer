import { useLocalStorage } from '@vueuse/core';
import { ref, watch } from 'vue';

// 专辑历史记录类型
export interface AlbumHistoryItem {
  id: number;
  name: string;
  picUrl?: string;
  size?: number; // 歌曲数量
  artist?: {
    name: string;
    id: number;
  };
  count?: number; // 播放次数
  lastPlayTime?: number; // 最后播放时间
}

export const useAlbumHistory = () => {
  const albumHistory = useLocalStorage<AlbumHistoryItem[]>('albumHistory', []);

  const addAlbum = (album: AlbumHistoryItem) => {
    const index = albumHistory.value.findIndex((item) => item.id === album.id);
    const now = Date.now();

    if (index !== -1) {
      // 如果已存在，更新播放次数和时间，并移到最前面
      albumHistory.value[index].count = (albumHistory.value[index].count || 0) + 1;
      albumHistory.value[index].lastPlayTime = now;
      albumHistory.value.unshift(albumHistory.value.splice(index, 1)[0]);
    } else {
      // 如果不存在，添加新记录
      albumHistory.value.unshift({
        ...album,
        count: 1,
        lastPlayTime: now
      });
    }
  };

  const delAlbum = (album: AlbumHistoryItem) => {
    const index = albumHistory.value.findIndex((item) => item.id === album.id);
    if (index !== -1) {
      albumHistory.value.splice(index, 1);
    }
  };

  const albumList = ref(albumHistory.value);

  watch(
    () => albumHistory.value,
    () => {
      albumList.value = albumHistory.value;
    },
    { deep: true }
  );

  return {
    albumHistory,
    albumList,
    addAlbum,
    delAlbum
  };
};

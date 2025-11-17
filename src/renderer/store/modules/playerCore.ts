import { cloneDeep } from 'lodash';
import { createDiscreteApi } from 'naive-ui';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import i18n from '@/../i18n/renderer';
import { getBilibiliAudioUrl } from '@/api/bilibili';
import { getParsingMusicUrl } from '@/api/music';
import { useMusicHistory } from '@/hooks/MusicHistoryHook';
import { useLyrics, useSongDetail } from '@/hooks/usePlayerHooks';
import { audioService } from '@/services/audioService';
import type { Platform, SongResult } from '@/types/music';
import { getImgUrl } from '@/utils';
import { getImageLinearBackground } from '@/utils/linearColor';

const musicHistory = useMusicHistory();
const { message } = createDiscreteApi(['message']);

/**
 * 核心播放控制 Store
 * 负责：播放/暂停、当前歌曲、音频URL、音量、播放速度、全屏状态
 */
export const usePlayerCoreStore = defineStore(
  'playerCore',
  () => {
    // ==================== 状态 ====================
    const play = ref(false);
    const isPlay = ref(false);
    const playMusic = ref<SongResult>({} as SongResult);
    const playMusicUrl = ref('');
    const musicFull = ref(false);
    const playbackRate = ref(1.0);
    const volume = ref(1);
    const userPlayIntent = ref(true);

    let checkPlayTime: NodeJS.Timeout | null = null;

    // ==================== Computed ====================
    const currentSong = computed(() => playMusic.value);
    const isPlaying = computed(() => isPlay.value);

    // ==================== Actions ====================

    /**
     * 设置播放状态
     */
    const setIsPlay = (value: boolean) => {
      isPlay.value = value;
      play.value = value;
      window.electron?.ipcRenderer.send('update-play-state', value);
    };

    /**
     * 设置全屏状态
     */
    const setMusicFull = (value: boolean) => {
      musicFull.value = value;
    };

    /**
     * 设置播放速度
     */
    const setPlaybackRate = (rate: number) => {
      playbackRate.value = rate;
      audioService.setPlaybackRate(rate);
    };

    /**
     * 设置音量
     */
    const setVolume = (newVolume: number) => {
      const normalizedVolume = Math.max(0, Math.min(1, newVolume));
      volume.value = normalizedVolume;
      audioService.setVolume(normalizedVolume);
    };

    /**
     * 获取音量
     */
    const getVolume = () => volume.value;

    /**
     * 增加音量
     */
    const increaseVolume = (step: number = 0.1) => {
      const newVolume = Math.min(1, volume.value + step);
      setVolume(newVolume);
      return newVolume;
    };

    /**
     * 减少音量
     */
    const decreaseVolume = (step: number = 0.1) => {
      const newVolume = Math.max(0, volume.value - step);
      setVolume(newVolume);
      return newVolume;
    };

    /**
     * 播放状态检测
     */
    const checkPlaybackState = (song: SongResult, timeout: number = 4000) => {
      if (checkPlayTime) {
        clearTimeout(checkPlayTime);
      }
      const sound = audioService.getCurrentSound();
      if (!sound) return;

      const onPlayHandler = () => {
        console.log('播放事件触发，歌曲成功开始播放');
        audioService.off('play', onPlayHandler);
        audioService.off('playerror', onPlayErrorHandler);
      };

      const onPlayErrorHandler = async () => {
        console.log('播放错误事件触发，尝试重新获取URL');
        audioService.off('play', onPlayHandler);
        audioService.off('playerror', onPlayErrorHandler);

        if (userPlayIntent.value && play.value) {
          playMusic.value.playMusicUrl = undefined;
          const refreshedSong = { ...song, isFirstPlay: true };
          await handlePlayMusic(refreshedSong, true);
        }
      };

      audioService.on('play', onPlayHandler);
      audioService.on('playerror', onPlayErrorHandler);

      checkPlayTime = setTimeout(() => {
        if (!audioService.isActuallyPlaying() && userPlayIntent.value && play.value) {
          console.log(`${timeout}ms后歌曲未真正播放且用户仍希望播放，尝试重新获取URL`);
          audioService.off('play', onPlayHandler);
          audioService.off('playerror', onPlayErrorHandler);

          playMusic.value.playMusicUrl = undefined;
          (async () => {
            const refreshedSong = { ...song, isFirstPlay: true };
            await handlePlayMusic(refreshedSong, true);
          })();
        }
      }, timeout);
    };

    /**
     * 核心播放处理函数
     */
    const handlePlayMusic = async (music: SongResult, isPlay: boolean = true) => {
      const currentSound = audioService.getCurrentSound();
      if (currentSound) {
        console.log('主动停止并卸载当前音频实例');
        currentSound.stop();
        currentSound.unload();
      }

      const originalMusic = { ...music };
      const { loadLrc } = useLyrics();
      const { getSongDetail } = useSongDetail();

      // 并行加载歌词和背景色
      const [lyrics, { backgroundColor, primaryColor }] = await Promise.all([
        (async () => {
          if (music.lyric && music.lyric.lrcTimeArray.length > 0) {
            return music.lyric;
          }
          return await loadLrc(music.id);
        })(),
        (async () => {
          if (music.backgroundColor && music.primaryColor) {
            return { backgroundColor: music.backgroundColor, primaryColor: music.primaryColor };
          }
          return await getImageLinearBackground(getImgUrl(music?.picUrl, '30y30'));
        })()
      ]);

      // 设置歌词和背景色
      music.lyric = lyrics;
      music.backgroundColor = backgroundColor;
      music.primaryColor = primaryColor;
      music.playLoading = true;

      // 更新 playMusic
      playMusic.value = music;
      play.value = isPlay;

      // 更新标题
      let title = music.name;
      if (music.source === 'netease' && music?.song?.artists) {
        title += ` - ${music.song.artists.reduce(
          (prev: string, curr: any) => `${prev}${curr.name}/`,
          ''
        )}`;
      } else if (music.source === 'bilibili' && music?.song?.ar?.[0]) {
        title += ` - ${music.song.ar[0].name}`;
      }
      document.title = 'AlgerMusic - ' + title;

      try {
        // 添加到历史记录
        musicHistory.addMusic(music);

        // 获取歌曲详情
        const updatedPlayMusic = await getSongDetail(originalMusic);
        updatedPlayMusic.lyric = lyrics;

        playMusic.value = updatedPlayMusic;
        playMusicUrl.value = updatedPlayMusic.playMusicUrl as string;
        music.playMusicUrl = updatedPlayMusic.playMusicUrl as string;

        // 在拆分后补充：触发预加载下一首/下下首（与 playlist store 保持一致）
        try {
          const { usePlaylistStore } = await import('./playlist');
          const playlistStore = usePlaylistStore();
          // 基于当前歌曲在播放列表中的位置来预加载
          const list = playlistStore.playList;
          if (Array.isArray(list) && list.length > 0) {
            const idx = list.findIndex(
              (item: SongResult) =>
                item.id === updatedPlayMusic.id && item.source === updatedPlayMusic.source
            );
            if (idx !== -1) {
              setTimeout(() => {
                playlistStore.preloadNextSongs(idx);
              }, 3000);
            }
          }
        } catch (e) {
          console.warn('预加载触发失败（可能是依赖未加载或循环依赖），已忽略:', e);
        }

        let playInProgress = false;

        try {
          if (playInProgress) {
            console.warn('播放操作正在进行中，避免重复调用');
            return true;
          }

          playInProgress = true;
          const result = await playAudio();
          playInProgress = false;
          return !!result;
        } catch (error) {
          console.error('自动播放音频失败:', error);
          playInProgress = false;
          return false;
        }
      } catch (error) {
        console.error('处理播放音乐失败:', error);
        message.error(i18n.global.t('player.playFailed'));
        if (playMusic.value) {
          playMusic.value.playLoading = false;
        }
        return false;
      }
    };

    /**
     * 播放音频
     */
    const playAudio = async () => {
      if (!playMusicUrl.value || !playMusic.value) return null;

      try {
        const shouldPlay = play.value;
        console.log('播放音频，当前播放状态:', shouldPlay ? '播放' : '暂停');

        // 检查保存的进度
        let initialPosition = 0;
        const savedProgress = JSON.parse(localStorage.getItem('playProgress') || '{}');
        if (savedProgress.songId === playMusic.value.id) {
          initialPosition = savedProgress.progress;
        }

        // B站视频URL检查
        if (
          playMusic.value.source === 'bilibili' &&
          (!playMusicUrl.value || playMusicUrl.value === 'undefined')
        ) {
          console.log('B站视频URL无效，尝试重新获取');

          if (playMusic.value.bilibiliData) {
            try {
              const proxyUrl = await getBilibiliAudioUrl(
                playMusic.value.bilibiliData.bvid,
                playMusic.value.bilibiliData.cid
              );

              (playMusic.value as any).playMusicUrl = proxyUrl;
              playMusicUrl.value = proxyUrl;
            } catch (error) {
              console.error('获取B站音频URL失败:', error);
              message.error(i18n.global.t('player.playFailed'));
              return null;
            }
          }
        }

        // 播放新音频
        const newSound = await audioService.play(
          playMusicUrl.value,
          playMusic.value,
          shouldPlay,
          initialPosition || 0
        );

        // 添加播放状态检测
        if (shouldPlay) {
          checkPlaybackState(playMusic.value);
        }

        // 发布音频就绪事件
        window.dispatchEvent(
          new CustomEvent('audio-ready', { detail: { sound: newSound, shouldPlay } })
        );

        return newSound;
      } catch (error) {
        console.error('播放音频失败:', error);
        setPlayMusic(false);

        const errorMsg = error instanceof Error ? error.message : String(error);

        // 操作锁错误处理
        if (errorMsg.includes('操作锁激活')) {
          console.log('由于操作锁正在使用，将在1000ms后重试');

          try {
            audioService.forceResetOperationLock();
            console.log('已强制重置操作锁');
          } catch (e) {
            console.error('重置操作锁失败:', e);
          }

          setTimeout(() => {
            if (userPlayIntent.value && play.value) {
              playAudio().catch((e) => {
                console.error('重试播放失败:', e);
              });
            }
          }, 1000);
        } else {
          // 非操作锁错误：尝试切到下一首，避免在解析失败时卡住
          try {
            const { usePlaylistStore } = await import('./playlist');
            const playlistStore = usePlaylistStore();
            if (Array.isArray(playlistStore.playList) && playlistStore.playList.length > 1) {
              setTimeout(() => {
                playlistStore.nextPlay();
              }, 300);
            }
          } catch (e) {
            console.warn('播放失败回退到下一首时发生问题（可能依赖未加载）:', e);
          }
        }

        message.error(i18n.global.t('player.playFailed'));
        return null;
      }
    };

    /**
     * 暂停播放
     */
    const handlePause = async () => {
      try {
        const currentSound = audioService.getCurrentSound();
        if (currentSound) {
          currentSound.pause();
        }
        setPlayMusic(false);
        userPlayIntent.value = false;
      } catch (error) {
        console.error('暂停播放失败:', error);
      }
    };

    /**
     * 设置播放/暂停
     */
    const setPlayMusic = async (value: boolean | SongResult) => {
      if (typeof value === 'boolean') {
        setIsPlay(value);
        userPlayIntent.value = value;
      } else {
        await handlePlayMusic(value);
        play.value = true;
        isPlay.value = true;
        userPlayIntent.value = true;
      }
    };

    /**
     * 使用指定音源重新解析当前歌曲
     */
    const reparseCurrentSong = async (sourcePlatform: Platform) => {
      try {
        const currentSong = playMusic.value;
        if (!currentSong || !currentSong.id) {
          console.warn('没有有效的播放对象');
          return false;
        }

        if (currentSong.source === 'bilibili') {
          console.warn('B站视频不支持重新解析');
          return false;
        }

        const songId = String(currentSong.id);
        localStorage.setItem(`song_source_${songId}`, JSON.stringify([sourcePlatform]));

        const currentSound = audioService.getCurrentSound();
        if (currentSound) {
          currentSound.pause();
        }

        const numericId =
          typeof currentSong.id === 'string' ? parseInt(currentSong.id, 10) : currentSong.id;

        console.log(`使用音源 ${sourcePlatform} 重新解析歌曲 ${numericId}`);

        const songData = cloneDeep(currentSong);
        const res = await getParsingMusicUrl(numericId, songData);

        if (res && res.data && res.data.data && res.data.data.url) {
          const newUrl = res.data.data.url;
          console.log(`解析成功，获取新URL: ${newUrl.substring(0, 50)}...`);

          const updatedMusic = {
            ...currentSong,
            playMusicUrl: newUrl,
            expiredAt: Date.now() + 1800000
          };

          await handlePlayMusic(updatedMusic, true);
          return true;
        } else {
          console.warn(`使用音源 ${sourcePlatform} 解析失败`);
          return false;
        }
      } catch (error) {
        console.error('重新解析失败:', error);
        return false;
      }
    };

    /**
     * 初始化播放状态
     */
    const initializePlayState = async () => {
      const { useSettingsStore } = await import('./settings');
      const settingStore = useSettingsStore();

      if (playMusic.value && Object.keys(playMusic.value).length > 0) {
        try {
          console.log('恢复上次播放的音乐:', playMusic.value.name);
          const isPlaying = settingStore.setData.autoPlay;

          if (playMusic.value.source === 'bilibili' && playMusic.value.bilibiliData) {
            console.log('恢复B站视频播放', playMusic.value.bilibiliData);
            playMusic.value.playMusicUrl = undefined;
          }

          await handlePlayMusic(
            { ...playMusic.value, isFirstPlay: true, playMusicUrl: undefined },
            isPlaying
          );
        } catch (error) {
          console.error('重新获取音乐链接失败:', error);
          play.value = false;
          isPlay.value = false;
          playMusic.value = {} as SongResult;
          playMusicUrl.value = '';
        }
      }

      setTimeout(() => {
        audioService.setPlaybackRate(playbackRate.value);
      }, 2000);
    };

    return {
      // 状态
      play,
      isPlay,
      playMusic,
      playMusicUrl,
      musicFull,
      playbackRate,
      volume,
      userPlayIntent,

      // Computed
      currentSong,
      isPlaying,

      // Actions
      setIsPlay,
      setMusicFull,
      setPlayMusic,
      setPlaybackRate,
      setVolume,
      getVolume,
      increaseVolume,
      decreaseVolume,
      handlePlayMusic,
      playAudio,
      handlePause,
      checkPlaybackState,
      reparseCurrentSong,
      initializePlayState
    };
  },
  {
    persist: {
      key: 'player-core-store',
      storage: localStorage,
      pick: ['playMusic', 'playMusicUrl', 'playbackRate', 'volume', 'isPlay']
    }
  }
);

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
import { playbackRequestManager } from '@/services/playbackRequestManager';
import { preloadService } from '@/services/preloadService';
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
    const triedSources = ref<Set<string>>(new Set());
    const triedSourceDiffs = ref<Map<string, number>>(new Map());
    const musicFull = ref(false);
    const playbackRate = ref(1.0);
    const volume = ref(1);
    const userPlayIntent = ref(false); // 用户是否想要播放

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
    const checkPlaybackState = (song: SongResult, requestId: string, timeout: number = 4000) => {
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
        console.log('播放错误事件触发，检查是否需要重新获取URL');
        audioService.off('play', onPlayHandler);
        audioService.off('playerror', onPlayErrorHandler);

        // 验证请求是否仍然有效
        if (!playbackRequestManager.isRequestValid(requestId)) {
          console.log('请求已过期，跳过重试');
          return;
        }

        if (userPlayIntent.value && play.value) {
          playMusic.value.playMusicUrl = undefined;
          const refreshedSong = { ...song, isFirstPlay: true };
          await handlePlayMusic(refreshedSong, true);
        }
      };

      audioService.on('play', onPlayHandler);
      audioService.on('playerror', onPlayErrorHandler);

      checkPlayTime = setTimeout(() => {
        // 验证请求是否仍然有效
        if (!playbackRequestManager.isRequestValid(requestId)) {
          console.log('请求已过期，跳过超时重试');
          audioService.off('play', onPlayHandler);
          audioService.off('playerror', onPlayErrorHandler);
          return;
        }

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
      // 如果是新歌曲，重置已尝试的音源
      if (music.id !== playMusic.value.id) {
        triedSources.value.clear();
        triedSourceDiffs.value.clear();
      }

      // 创建新的播放请求并取消之前的所有请求
      const requestId = playbackRequestManager.createRequest(music);
      console.log(`[handlePlayMusic] 开始处理歌曲: ${music.name}, 请求ID: ${requestId}`);

      const currentSound = audioService.getCurrentSound();
      if (currentSound) {
        console.log('主动停止并卸载当前音频实例');
        currentSound.stop();
        currentSound.unload();
      }

      // 验证请求是否仍然有效
      if (!playbackRequestManager.isRequestValid(requestId)) {
        console.log(`[handlePlayMusic] 请求已失效: ${requestId}`);
        return false;
      }

      // 激活请求
      if (!playbackRequestManager.activateRequest(requestId)) {
        console.log(`[handlePlayMusic] 无法激活请求: ${requestId}`);
        return false;
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

      // 在更新状态前再次验证请求
      if (!playbackRequestManager.isRequestValid(requestId)) {
        console.log(`[handlePlayMusic] 加载歌词/背景色后请求已失效: ${requestId}`);
        return false;
      }

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
        const updatedPlayMusic = await getSongDetail(originalMusic, requestId);

        // 在获取详情后再次验证请求
        if (!playbackRequestManager.isRequestValid(requestId)) {
          console.log(`[handlePlayMusic] 获取歌曲详情后请求已失效: ${requestId}`);
          playbackRequestManager.failRequest(requestId);
          return false;
        }

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
          const result = await playAudio(requestId);
          playInProgress = false;

          if (result) {
            playbackRequestManager.completeRequest(requestId);
            return true;
          } else {
            playbackRequestManager.failRequest(requestId);
            return false;
          }
        } catch (error) {
          console.error('自动播放音频失败:', error);
          playInProgress = false;
          playbackRequestManager.failRequest(requestId);
          return false;
        }
      } catch (error) {
        console.error('处理播放音乐失败:', error);
        message.error(i18n.global.t('player.playFailed'));
        if (playMusic.value) {
          playMusic.value.playLoading = false;
        }
        playbackRequestManager.failRequest(requestId);

        // 通知外部播放失败，需要跳到下一首
        try {
          const { usePlaylistStore } = await import('./playlist');
          const playlistStore = usePlaylistStore();
          if (Array.isArray(playlistStore.playList) && playlistStore.playList.length > 1) {
            message.warning('歌曲解析失败 播放下一首');
            setTimeout(() => {
              playlistStore.nextPlay();
            }, 500);
          }
        } catch (e) {
          console.warn('切换下一首时发生问题:', e);
        }

        return false;
      }
    };

    /**
     * 播放音频
     */
    const playAudio = async (requestId?: string) => {
      if (!playMusicUrl.value || !playMusic.value) return null;

      // 如果提供了 requestId，验证请求是否仍然有效
      if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
        console.log(`[playAudio] 请求已失效: ${requestId}`);
        return null;
      }

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

              // 再次验证请求
              if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
                console.log(`[playAudio] 获取B站URL后请求已失效: ${requestId}`);
                return null;
              }

              (playMusic.value as any).playMusicUrl = proxyUrl;
              playMusicUrl.value = proxyUrl;
            } catch (error) {
              console.error('获取B站音频URL失败:', error);
              message.error(i18n.global.t('player.playFailed'));
              return null;
            }
          }
        }

        // 使用 PreloadService 加载音频
        // 这将确保如果正在进行预加载修复，我们会等待它完成
        // 同时也处理了时长检查和自动修复逻辑
        let sound: Howl;
        try {
          sound = await preloadService.load(playMusic.value);
        } catch (error) {
          console.error('PreloadService 加载失败:', error);
          // 如果 PreloadService 失败，尝试直接播放作为回退
          // 但通常 PreloadService 失败意味着 URL 问题
          throw error;
        }

        // 播放新音频，传入已加载的 sound 实例
        const newSound = await audioService.play(
          playMusicUrl.value,
          playMusic.value,
          shouldPlay,
          initialPosition || 0,
          sound
        );

        // 播放后再次验证请求
        if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
          console.log(`[playAudio] 播放后请求已失效: ${requestId}`);
          newSound.stop();
          newSound.unload();
          return null;
        }

        // 添加播放状态检测
        if (shouldPlay && requestId) {
          checkPlaybackState(playMusic.value, requestId);
        }

        // 发布音频就绪事件
        window.dispatchEvent(
          new CustomEvent('audio-ready', { detail: { sound: newSound, shouldPlay } })
        );

        // 检查时长是否匹配，如果不匹配则尝试自动重新解析
        const duration = newSound.duration();
        const expectedDuration = (playMusic.value.dt || 0) / 1000;

        // 如果时长差异超过5秒，且不是B站视频，且预期时长大于0
        if (
          expectedDuration > 0 &&
          Math.abs(duration - expectedDuration) > 5 &&
          playMusic.value.source !== 'bilibili' &&
          playMusic.value.id
        ) {
          const songId = String(playMusic.value.id);
          const sourceType = localStorage.getItem(`song_source_type_${songId}`);

          // 如果不是用户手动锁定的音源
          if (sourceType !== 'manual') {
            console.warn(
              `时长不匹配 (实际: ${duration}s, 预期: ${expectedDuration}s)，尝试自动切换音源`
            );

            // 记录当前失败的音源
            // 注意：这里假设当前使用的音源是 playMusic.value.source，或者是刚刚解析出来的
            // 但实际上我们需要知道当前具体是用哪个平台解析成功的，这可能需要从 getSongUrl 的结果中获取
            // 暂时简单处理，将当前配置的来源加入已尝试列表

            // 获取所有可用音源
            const { useSettingsStore } = await import('./settings');
            const settingsStore = useSettingsStore();
            const enabledSources = settingsStore.setData.enabledMusicSources || [
              'migu',
              'kugou',
              'pyncmd',
              'gdmusic'
            ];
            const availableSources: Platform[] = enabledSources.filter(
              (s: string) => s !== 'bilibili'
            );

            // 将当前正在使用的音源加入已尝试列表
            let currentSource = 'unknown';
            const currentSavedSource = localStorage.getItem(`song_source_${songId}`);
            if (currentSavedSource) {
              try {
                const sources = JSON.parse(currentSavedSource);
                if (Array.isArray(sources) && sources.length > 0) {
                  currentSource = sources[0];
                  triedSources.value.add(currentSource);
                }
              } catch {
                console.error(`解析当前音源失败: ${currentSource}`);
              }
            }

            // 找到下一个未尝试的音源
            const nextSource = availableSources.find((s) => !triedSources.value.has(s));

            // 记录当前音源的时间差
            if (currentSource !== 'unknown') {
              triedSourceDiffs.value.set(currentSource, Math.abs(duration - expectedDuration));
            }

            if (nextSource) {
              console.log(`自动切换到音源: ${nextSource}`);
              newSound.stop();
              newSound.unload();

              // 递归调用 reparseCurrentSong
              // 注意：这里是异步调用，不会阻塞当前函数返回，但我们已经停止了播放
              const success = await reparseCurrentSong(nextSource, true);
              if (success) {
                return audioService.getCurrentSound();
              }
              return null;
            } else {
              console.warn('所有音源都已尝试，寻找最接近时长的版本');

              // 找出时间差最小的音源
              let bestSource = '';
              let minDiff = Infinity;

              for (const [source, diff] of triedSourceDiffs.value.entries()) {
                if (diff < minDiff) {
                  minDiff = diff;
                  bestSource = source;
                }
              }

              // 如果找到了最佳音源，且不是当前正在播放的音源
              if (bestSource && bestSource !== currentSource) {
                console.log(`切换到最佳匹配音源: ${bestSource} (差异: ${minDiff}s)`);
                newSound.stop();
                newSound.unload();

                const success = await reparseCurrentSong(bestSource as Platform, true);
                if (success) {
                  return audioService.getCurrentSound();
                }
                return null;
              }

              console.log(`当前音源 ${currentSource} 已经是最佳匹配 (差异: ${minDiff}s)，保留播放`);
            }
          }
        }

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
            // 验证请求是否仍然有效再重试
            if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
              console.log('重试时请求已失效，跳过重试');
              return;
            }
            if (userPlayIntent.value && play.value) {
              playAudio(requestId).catch((e) => {
                console.error('重试播放失败:', e);
              });
            }
          }, 1000);
        } else {
          // 非操作锁错误：尝试切到下一首，避免在解析失败时卡住
          message.warning('歌曲解析失败 播放下一首');
          try {
            const { usePlaylistStore } = await import('./playlist');
            const playlistStore = usePlaylistStore();
            if (Array.isArray(playlistStore.playList) && playlistStore.playList.length > 1) {
              setTimeout(() => {
                playlistStore.nextPlay();
              }, 500);
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
    const reparseCurrentSong = async (sourcePlatform: Platform, isAuto: boolean = false) => {
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

        // 记录音源设置类型（自动/手动）
        localStorage.setItem(`song_source_type_${songId}`, isAuto ? 'auto' : 'manual');

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

          // 更新播放列表中的歌曲信息
          const { usePlaylistStore } = await import('./playlist');
          const playlistStore = usePlaylistStore();
          playlistStore.updateSong(updatedMusic);

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

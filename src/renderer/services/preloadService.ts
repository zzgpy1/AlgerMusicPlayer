import { Howl } from 'howler';
import { cloneDeep } from 'lodash';

import { getParsingMusicUrl } from '@/api/music';
import type { SongResult } from '@/types/music';

class PreloadService {
  private loadingPromises: Map<string | number, Promise<Howl>> = new Map();
  private preloadedSounds: Map<string | number, Howl> = new Map();

  /**
   * 加载并验证音频
   * 如果已经在加载中，返回现有的 Promise
   * 如果已经加载完成，返回缓存的 Howl 实例
   */
  public async load(song: SongResult): Promise<Howl> {
    if (!song || !song.id) {
      throw new Error('无效的歌曲对象');
    }

    // 1. 检查是否有正在进行的加载
    if (this.loadingPromises.has(song.id)) {
      console.log(`[PreloadService] 歌曲 ${song.name} 正在加载中，复用现有请求`);
      return this.loadingPromises.get(song.id)!;
    }

    // 2. 检查是否有已完成的缓存
    if (this.preloadedSounds.has(song.id)) {
      const sound = this.preloadedSounds.get(song.id)!;
      if (sound.state() === 'loaded') {
        console.log(`[PreloadService] 歌曲 ${song.name} 已预加载完成，直接使用`);
        return sound;
      } else {
        // 如果缓存的音频状态不正常，清理并重新加载
        this.preloadedSounds.delete(song.id);
      }
    }

    // 3. 开始新的加载过程
    const loadPromise = this._performLoad(song);
    this.loadingPromises.set(song.id, loadPromise);

    try {
      const sound = await loadPromise;
      this.preloadedSounds.set(song.id, sound);
      return sound;
    } finally {
      this.loadingPromises.delete(song.id);
    }
  }

  /**
   * 执行实际的加载和验证逻辑
   */
  private async _performLoad(song: SongResult): Promise<Howl> {
    console.log(`[PreloadService] 开始加载歌曲: ${song.name}`);

    if (!song.playMusicUrl) {
      throw new Error('歌曲没有 URL');
    }

    // 创建初始音频实例
    let sound = await this._createSound(song.playMusicUrl);

    // 检查时长
    const duration = sound.duration();
    const expectedDuration = (song.dt || 0) / 1000;

    // 如果时长差异超过5秒，且不是B站视频，且预期时长大于0
    if (
      expectedDuration > 0 &&
      Math.abs(duration - expectedDuration) > 5 &&
      song.source !== 'bilibili'
    ) {
      const songId = String(song.id);
      const sourceType = localStorage.getItem(`song_source_type_${songId}`);

      // 如果不是用户手动锁定的音源，尝试自动重新解析
      if (sourceType !== 'manual') {
        console.warn(
          `[PreloadService] 时长不匹配 (实际: ${duration}s, 预期: ${expectedDuration}s)，尝试智能解析`
        );

        // 动态导入 store
        const { useSettingsStore } = await import('@/store/modules/settings');
        const { usePlaylistStore } = await import('@/store/modules/playlist');
        const settingsStore = useSettingsStore();
        const playlistStore = usePlaylistStore();

        const enabledSources = settingsStore.setData.enabledMusicSources || [
          'migu',
          'kugou',
          'pyncmd',
          'gdmusic'
        ];
        const availableSources = enabledSources.filter((s: string) => s !== 'bilibili');

        const triedSources = new Set<string>();
        const triedSourceDiffs = new Map<string, number>();

        // 记录当前音源
        let currentSource = 'unknown';
        const currentSavedSource = localStorage.getItem(`song_source_${songId}`);
        if (currentSavedSource) {
          try {
            const sources = JSON.parse(currentSavedSource);
            if (Array.isArray(sources) && sources.length > 0) {
              currentSource = sources[0];
            }
          } catch (e) {
            console.log(
              `[PreloadService] 时长不匹配 (实际: ${duration}s, 预期: ${expectedDuration}s)，尝试智能解析`,
              e
            );
          }
        }

        triedSources.add(currentSource);
        triedSourceDiffs.set(currentSource, Math.abs(duration - expectedDuration));

        // 卸载当前不匹配的音频
        sound.unload();

        // 尝试其他音源
        for (const source of availableSources) {
          if (triedSources.has(source)) continue;

          console.log(`[PreloadService] 尝试音源: ${source}`);
          triedSources.add(source);

          try {
            const songData = cloneDeep(song);
            // 临时保存设置以便 getParsingMusicUrl 使用
            localStorage.setItem(`song_source_${songId}`, JSON.stringify([source]));

            const res = await getParsingMusicUrl(
              typeof song.id === 'string' ? parseInt(song.id) : song.id,
              songData
            );

            if (res && res.data && res.data.data && res.data.data.url) {
              const newUrl = res.data.data.url;
              const tempSound = await this._createSound(newUrl);
              const newDuration = tempSound.duration();
              const diff = Math.abs(newDuration - expectedDuration);

              triedSourceDiffs.set(source, diff);

              if (diff <= 5) {
                console.log(`[PreloadService] 找到匹配音源: ${source}, 更新歌曲信息`);

                // 更新歌曲信息
                const updatedSong = {
                  ...song,
                  playMusicUrl: newUrl,
                  expiredAt: Date.now() + 1800000
                };

                // 更新 store
                playlistStore.updateSong(updatedSong);

                // 记录新的音源设置
                localStorage.setItem(`song_source_${songId}`, JSON.stringify([source]));
                localStorage.setItem(`song_source_type_${songId}`, 'auto');

                return tempSound;
              } else {
                tempSound.unload();
              }
            }
          } catch (e) {
            console.error(`[PreloadService] 尝试音源 ${source} 失败:`, e);
          }
        }

        // 如果没有找到完美匹配，使用最佳匹配
        console.warn('[PreloadService] 未找到完美匹配，寻找最佳匹配');
        let bestSource = '';
        let minDiff = Infinity;

        for (const [source, diff] of triedSourceDiffs.entries()) {
          if (diff < minDiff) {
            minDiff = diff;
            bestSource = source;
          }
        }

        if (bestSource && bestSource !== currentSource) {
          console.log(`[PreloadService] 使用最佳匹配音源: ${bestSource} (差异: ${minDiff}s)`);
          try {
            const songData = cloneDeep(song);
            localStorage.setItem(`song_source_${songId}`, JSON.stringify([bestSource]));

            const res = await getParsingMusicUrl(
              typeof song.id === 'string' ? parseInt(song.id) : song.id,
              songData
            );

            if (res && res.data && res.data.data && res.data.data.url) {
              const newUrl = res.data.data.url;
              const bestSound = await this._createSound(newUrl);

              const updatedSong = {
                ...song,
                playMusicUrl: newUrl,
                expiredAt: Date.now() + 1800000
              };

              playlistStore.updateSong(updatedSong);
              localStorage.setItem(`song_source_type_${songId}`, 'auto');

              return bestSound;
            }
          } catch (e) {
            console.error(`[PreloadService] 获取最佳匹配音源失败:`, e);
          }
        }
      }
    }

    // 如果不需要修复或修复失败，重新加载原始音频（因为上面可能unload了）
    if (sound.state() === 'unloaded') {
      sound = await this._createSound(song.playMusicUrl);
    }

    return sound;
  }

  private _createSound(url: string): Promise<Howl> {
    return new Promise((resolve, reject) => {
      const sound = new Howl({
        src: [url],
        html5: true,
        preload: true,
        autoplay: false,
        onload: () => resolve(sound),
        onloaderror: (_, err) => reject(err)
      });
    });
  }

  /**
   * 取消特定歌曲的预加载（如果可能）
   * 注意：Promise 无法真正取消，但我们可以清理结果
   */
  public cancel(songId: string | number) {
    if (this.preloadedSounds.has(songId)) {
      const sound = this.preloadedSounds.get(songId)!;
      sound.unload();
      this.preloadedSounds.delete(songId);
    }
    // loadingPromises 中的任务会继续执行，但因为 preloadedSounds 中没有记录，
    // 下次请求时会重新加载（或者我们可以让 _performLoad 检查一个取消标记，但这增加了复杂性）
  }

  /**
   * 获取已预加载的音频实例（如果存在）
   */
  public getPreloadedSound(songId: string | number): Howl | undefined {
    return this.preloadedSounds.get(songId);
  }

  /**
   * 清理所有预加载资源
   */
  public clearAll() {
    this.preloadedSounds.forEach((sound) => sound.unload());
    this.preloadedSounds.clear();
    this.loadingPromises.clear();
  }
}

export const preloadService = new PreloadService();

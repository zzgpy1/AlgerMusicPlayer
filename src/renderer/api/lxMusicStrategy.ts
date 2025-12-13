/**
 * 落雪音乐 (LX Music) 音源解析策略
 *
 * 实现 MusicSourceStrategy 接口，作为落雪音源的解析入口
 */

import { getLxMusicRunner, initLxMusicRunner } from '@/services/LxMusicSourceRunner';
import { useSettingsStore } from '@/store';
import type { LxMusicInfo, LxQuality, LxSourceKey } from '@/types/lxMusic';
import { LX_SOURCE_NAMES, QUALITY_TO_LX } from '@/types/lxMusic';
import type { SongResult } from '@/types/music';

import type { MusicParseResult } from './musicParser';
import { CacheManager } from './musicParser';

/**
 * 将 SongResult 转换为 LxMusicInfo 格式
 */
const convertToLxMusicInfo = (songResult: SongResult): LxMusicInfo => {
  const artistName =
    songResult.ar && songResult.ar.length > 0
      ? songResult.ar.map((a) => a.name).join('、')
      : songResult.artists && songResult.artists.length > 0
        ? songResult.artists.map((a) => a.name).join('、')
        : '';

  const albumName = songResult.al?.name || (songResult.album as any)?.name || '';

  const albumId = songResult.al?.id || (songResult.album as any)?.id || '';

  // 计算时长（秒转分钟:秒格式）
  const duration = songResult.dt || songResult.duration || 0;
  const minutes = Math.floor(duration / 60000);
  const seconds = Math.floor((duration % 60000) / 1000);
  const interval = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  return {
    songmid: songResult.id,
    name: songResult.name,
    singer: artistName,
    album: albumName,
    albumId,
    source: 'wy', // 默认使用网易云作为源，因为我们的数据来自网易云
    interval,
    img: songResult.picUrl || songResult.al?.picUrl || ''
  };
};

/**
 * 获取最佳匹配的落雪音源
 * 因为我们的数据来自网易云，优先尝试 wy 音源
 */
const getBestMatchingSource = (
  availableSources: LxSourceKey[],
  _songSource?: string
): LxSourceKey | null => {
  // 优先级顺序：网易云 > 酷我 > 咪咕 > 酷狗 > QQ音乐
  const priority: LxSourceKey[] = ['wy', 'kw', 'mg', 'kg', 'tx'];

  for (const source of priority) {
    if (availableSources.includes(source)) {
      return source;
    }
  }

  return availableSources[0] || null;
};

/**
 * 落雪音乐解析策略
 */
export class LxMusicStrategy {
  name = 'lxMusic';
  priority = 0; // 最高优先级

  /**
   * 检查是否可以处理
   */
  canHandle(sources: string[], settingsStore?: any): boolean {
    // 检查是否启用了落雪音源
    if (!sources.includes('lxMusic')) {
      return false;
    }

    // 检查是否导入了脚本
    const script = settingsStore?.setData?.lxMusicScript;
    return Boolean(script);
  }

  /**
   * 解析音乐 URL
   */
  async parse(
    id: number,
    data: SongResult,
    quality?: string,
    _sources?: string[]
  ): Promise<MusicParseResult | null> {
    // 检查失败缓存
    if (CacheManager.isInFailedCache(id, this.name)) {
      return null;
    }

    try {
      const settingsStore = useSettingsStore();
      const script = settingsStore.setData?.lxMusicScript;

      if (!script) {
        console.log('[LxMusicStrategy] 未导入落雪音源脚本');
        return null;
      }

      // 获取或初始化执行器
      let runner = getLxMusicRunner();
      if (!runner || !runner.isInitialized()) {
        console.log('[LxMusicStrategy] 初始化落雪音源执行器...');
        runner = await initLxMusicRunner(script);
      }

      // 获取可用音源
      const sources = runner.getSources();
      const availableSourceKeys = Object.keys(sources) as LxSourceKey[];

      if (availableSourceKeys.length === 0) {
        console.log('[LxMusicStrategy] 没有可用的落雪音源');
        CacheManager.addFailedCache(id, this.name);
        return null;
      }

      // 选择最佳音源
      const bestSource = getBestMatchingSource(availableSourceKeys);
      if (!bestSource) {
        console.log('[LxMusicStrategy] 无法找到匹配的音源');
        CacheManager.addFailedCache(id, this.name);
        return null;
      }

      console.log(`[LxMusicStrategy] 使用音源: ${LX_SOURCE_NAMES[bestSource]} (${bestSource})`);

      // 转换歌曲信息
      const lxMusicInfo = convertToLxMusicInfo(data);

      // 转换音质
      const lxQuality: LxQuality = QUALITY_TO_LX[quality || 'higher'] || '320k';

      // 获取音乐 URL
      const url = await runner.getMusicUrl(bestSource, lxMusicInfo, lxQuality);

      if (!url) {
        console.log('[LxMusicStrategy] 获取 URL 失败');
        CacheManager.addFailedCache(id, this.name);
        return null;
      }

      console.log('[LxMusicStrategy] 解析成功:', url.substring(0, 50) + '...');

      return {
        data: {
          code: 200,
          message: 'success',
          data: {
            url,
            source: `lx-${bestSource}`,
            quality: lxQuality
          }
        }
      };
    } catch (error) {
      console.error('[LxMusicStrategy] 解析失败:', error);
      CacheManager.addFailedCache(id, this.name);
      return null;
    }
  }
}

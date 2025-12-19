/**
 * 落雪音乐 (LX Music) 音源脚本执行器
 *
 * 核心职责：
 * 1. 解析脚本元信息
 * 2. 在隔离环境中执行用户脚本
 * 3. 模拟 globalThis.lx API
 * 4. 处理初始化和音乐解析请求
 */

import type {
  LxInitedData,
  LxLyricResult,
  LxMusicInfo,
  LxQuality,
  LxScriptInfo,
  LxSourceConfig,
  LxSourceKey
} from '@/types/lxMusic';
import * as lxCrypto from '@/utils/lxCrypto';

/**
 * 解析脚本头部注释中的元信息
 */
export const parseScriptInfo = (script: string): LxScriptInfo => {
  const info: LxScriptInfo = {
    name: '未知音源',
    rawScript: script
  };

  // 尝试匹配不同格式的头部注释块
  // 支持 /** ... */ 和 /* ... */ 格式
  const headerMatch = script.match(/^\/\*+[\s\S]*?\*\//);
  if (!headerMatch) {
    console.warn('[parseScriptInfo] 未找到脚本头部注释块');
    return info;
  }

  const header = headerMatch[0];
  console.log('[parseScriptInfo] 解析脚本头部:', header.substring(0, 200));

  // 解析各个字段（支持 * 前缀和无前缀两种格式）
  const nameMatch = header.match(/@name\s+(.+?)(?:\r?\n|\*\/)/);
  if (nameMatch) {
    info.name = nameMatch[1].trim().replace(/^\*\s*/, '');
    console.log('[parseScriptInfo] 解析到名称:', info.name);
  } else {
    console.warn('[parseScriptInfo] 未找到 @name 标签');
  }

  const descMatch = header.match(/@description\s+(.+?)(?:\r?\n|\*\/)/);
  if (descMatch) {
    info.description = descMatch[1].trim().replace(/^\*\s*/, '');
  }

  const versionMatch = header.match(/@version\s+(.+?)(?:\r?\n|\*\/)/);
  if (versionMatch) {
    info.version = versionMatch[1].trim().replace(/^\*\s*/, '');
    console.log('[parseScriptInfo] 解析到版本:', info.version);
  }

  const authorMatch = header.match(/@author\s+(.+?)(?:\r?\n|\*\/)/);
  if (authorMatch) {
    info.author = authorMatch[1].trim().replace(/^\*\s*/, '');
  }

  const homepageMatch = header.match(/@homepage\s+(.+?)(?:\r?\n|\*\/)/);
  if (homepageMatch) {
    info.homepage = homepageMatch[1].trim().replace(/^\*\s*/, '');
  }

  return info;
};

/**
 * 落雪音源脚本执行器
 * 使用 Worker 或 iframe 隔离执行用户脚本
 */
export class LxMusicSourceRunner {
  private script: string;
  private scriptInfo: LxScriptInfo;
  private sources: Partial<Record<LxSourceKey, LxSourceConfig>> = {};
  private requestHandler: ((data: any) => Promise<any>) | null = null;
  private initialized = false;
  private initPromise: Promise<LxInitedData> | null = null;
  // 临时存储最后一次 HTTP 请求返回的音乐 URL（用于脚本返回 undefined 时的后备）
  private lastMusicUrl: string | null = null;

  constructor(script: string) {
    this.script = script;
    this.scriptInfo = parseScriptInfo(script);
  }

  /**
   * 获取脚本信息
   */
  getScriptInfo(): LxScriptInfo {
    return this.scriptInfo;
  }

  /**
   * 获取支持的音源列表
   */
  getSources(): Partial<Record<LxSourceKey, LxSourceConfig>> {
    return this.sources;
  }

  /**
   * 初始化执行器
   */
  async initialize(): Promise<LxInitedData> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<LxInitedData>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('脚本初始化超时'));
      }, 10000);

      try {
        // 创建沙盒环境并执行脚本
        this.executeSandboxed(
          (initedData) => {
            clearTimeout(timeout);
            this.sources = initedData.sources;
            this.initialized = true;
            console.log('[LxMusicRunner] 初始化成功:', initedData.sources);
            resolve(initedData);
          },
          (error) => {
            clearTimeout(timeout);
            reject(error);
          }
        );
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });

    return this.initPromise;
  }

  /**
   * 在沙盒中执行脚本
   */
  private executeSandboxed(
    onInited: (data: LxInitedData) => void,
    onError: (error: Error) => void
  ): void {
    // 构建沙盒执行环境
    const sandbox = this.createSandbox(onInited, onError);

    try {
      // 使用 Function 构造器在受限环境中执行
      // 注意：不能使用 const/let 声明 globalThis，因为它是保留标识符
      const sandboxedScript = `
        (function() {
          ${sandbox.apiSetup}
          ${this.script}
        }).call(this);
      `;

      // 创建执行上下文
      const context = sandbox.context;
      const executor = new Function(sandboxedScript);

      // 在隔离上下文中执行，context 将作为 this
      executor.call(context);
    } catch (error) {
      onError(error as Error);
    }
  }

  /**
   * 创建沙盒环境
   */
  private createSandbox(
    onInited: (data: LxInitedData) => void,
    _onError: (error: Error) => void
  ): { apiSetup: string; context: any } {
    const self = this;

    // 创建 globalThis.lx 对象
    // 版本号使用落雪音乐最新版本以通过脚本版本检测
    const context = {
      lx: {
        version: '2.8.0',
        env: 'desktop',
        appInfo: {
          version: '2.8.0',
          versionNum: 208,
          locale: 'zh-cn'
        },
        currentScriptInfo: this.scriptInfo,
        EVENT_NAMES: {
          inited: 'inited',
          request: 'request',
          updateAlert: 'updateAlert'
        },
        on: (eventName: string, handler: (data: any) => Promise<any>) => {
          if (eventName === 'request') {
            self.requestHandler = handler;
          }
        },
        send: (eventName: string, data: any) => {
          if (eventName === 'inited') {
            onInited(data as LxInitedData);
          } else if (eventName === 'updateAlert') {
            console.log('[LxMusicRunner] 更新提醒:', data);
          }
        },
        request: (
          url: string,
          options: any,
          callback: (err: Error | null, resp: any, body: any) => void
        ) => {
          return self.handleHttpRequest(url, options, callback);
        },
        utils: {
          buffer: {
            from: (data: any, _encoding?: string) => {
              if (typeof data === 'string') {
                return new TextEncoder().encode(data);
              }
              return new Uint8Array(data);
            },
            bufToString: (buffer: Uint8Array, encoding?: string) => {
              return new TextDecoder(encoding || 'utf-8').decode(buffer);
            }
          },
          crypto: {
            md5: lxCrypto.md5,
            sha1: lxCrypto.sha1,
            sha256: lxCrypto.sha256,
            randomBytes: lxCrypto.randomBytes,
            aesEncrypt: lxCrypto.aesEncrypt,
            aesDecrypt: lxCrypto.aesDecrypt,
            rsaEncrypt: lxCrypto.rsaEncrypt,
            rsaDecrypt: lxCrypto.rsaDecrypt,
            base64Encode: lxCrypto.base64Encode,
            base64Decode: lxCrypto.base64Decode
          },
          zlib: {
            inflate: async (buffer: ArrayBuffer) => {
              try {
                const ds = new DecompressionStream('deflate');
                const writer = ds.writable.getWriter();
                writer.write(buffer);
                writer.close();
                const reader = ds.readable.getReader();
                const chunks: Uint8Array[] = [];
                let done = false;
                while (!done) {
                  const result = await reader.read();
                  done = result.done;
                  if (result.value) chunks.push(result.value);
                }
                const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
                const result = new Uint8Array(totalLength);
                let offset = 0;
                for (const chunk of chunks) {
                  result.set(chunk, offset);
                  offset += chunk.length;
                }
                return result.buffer;
              } catch {
                return buffer;
              }
            },
            deflate: async (buffer: ArrayBuffer) => {
              try {
                const cs = new CompressionStream('deflate');
                const writer = cs.writable.getWriter();
                writer.write(buffer);
                writer.close();
                const reader = cs.readable.getReader();
                const chunks: Uint8Array[] = [];
                let done = false;
                while (!done) {
                  const result = await reader.read();
                  done = result.done;
                  if (result.value) chunks.push(result.value);
                }
                const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
                const result = new Uint8Array(totalLength);
                let offset = 0;
                for (const chunk of chunks) {
                  result.set(chunk, offset);
                  offset += chunk.length;
                }
                return result.buffer;
              } catch {
                return buffer;
              }
            }
          }
        }
      },
      console: {
        log: (...args: any[]) => console.log('[LxScript]', ...args),
        error: (...args: any[]) => console.error('[LxScript]', ...args),
        warn: (...args: any[]) => console.warn('[LxScript]', ...args),
        info: (...args: any[]) => console.info('[LxScript]', ...args)
      },
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      Promise,
      JSON,
      Object,
      Array,
      String,
      Number,
      Boolean,
      Date,
      Math,
      RegExp,
      Error,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Symbol,
      Proxy,
      Reflect,
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
      atob,
      btoa,
      TextEncoder,
      TextDecoder,
      Uint8Array,
      ArrayBuffer,
      crypto
    };

    // 只设置 lx 和 globalThis，不解构变量避免与脚本内部声明冲突
    const apiSetup = `
      var lx = this.lx;
      var globalThis = this;
    `;

    return { apiSetup, context };
  }

  /**
   * 处理 HTTP 请求（优先使用主进程，绕过 CORS 限制）
   */
  private handleHttpRequest(
    url: string,
    options: any,
    callback: (err: Error | null, resp: any, body: any) => void
  ): () => void {
    console.log(`[LxMusicRunner] HTTP 请求: ${options.method || 'GET'} ${url}`);

    const timeout = options.timeout || 30000;
    const requestId = `lx_http_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // 尝试使用主进程 HTTP 请求（如果可用）
    const hasMainProcessHttp = typeof window.api?.lxMusicHttpRequest === 'function';

    if (hasMainProcessHttp) {
      // 使用主进程 HTTP 请求（绕过 CORS）
      console.log(`[LxMusicRunner] 使用主进程 HTTP 请求`);

      window.api
        .lxMusicHttpRequest({
          url,
          options: {
            ...options,
            timeout
          },
          requestId
        })
        .then((response: any) => {
          console.log(`[LxMusicRunner] HTTP 响应: ${response.statusCode} ${url}`);

          // 如果响应中包含 URL，缓存下来以备后用
          if (response.body && response.body.url && typeof response.body.url === 'string') {
            this.lastMusicUrl = response.body.url;
          }

          callback(null, response, response.body);
        })
        .catch((error: Error) => {
          console.error(`[LxMusicRunner] HTTP 请求失败: ${url}`, error.message);
          callback(error, null, null);
        });

      // 返回取消函数
      return () => {
        void window.api?.lxMusicHttpCancel?.(requestId);
      };
    } else {
      // 回退到渲染进程 fetch（可能受 CORS 限制）
      console.log(`[LxMusicRunner] 主进程 HTTP 不可用，使用渲染进程 fetch`);

      const controller = new AbortController();

      const fetchOptions: RequestInit = {
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...options.headers
        },
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit'
      };

      if (options.body) {
        fetchOptions.body = options.body;
      } else if (options.form) {
        fetchOptions.body = new URLSearchParams(options.form);
        fetchOptions.headers = {
          ...fetchOptions.headers,
          'Content-Type': 'application/x-www-form-urlencoded'
        };
      } else if (options.formData) {
        const formData = new FormData();
        for (const [key, value] of Object.entries(options.formData)) {
          formData.append(key, value as string);
        }
        fetchOptions.body = formData;
      }

      const timeoutId = setTimeout(() => {
        console.warn(`[LxMusicRunner] HTTP 请求超时: ${url}`);
        controller.abort();
      }, timeout);

      fetch(url, fetchOptions)
        .then(async (response) => {
          clearTimeout(timeoutId);
          console.log(`[LxMusicRunner] HTTP 响应: ${response.status} ${url}`);

          const rawBody = await response.text();

          // 尝试解析 JSON
          let parsedBody: any = rawBody;
          const contentType = response.headers.get('content-type') || '';
          if (
            contentType.includes('application/json') ||
            rawBody.startsWith('{') ||
            rawBody.startsWith('[')
          ) {
            try {
              parsedBody = JSON.parse(rawBody);
              if (parsedBody && parsedBody.url && typeof parsedBody.url === 'string') {
                this.lastMusicUrl = parsedBody.url;
              }
            } catch {
              // 解析失败则使用原始字符串
            }
          }

          callback(
            null,
            {
              statusCode: response.status,
              headers: Object.fromEntries(response.headers.entries()),
              body: parsedBody
            },
            parsedBody
          );
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          console.error(`[LxMusicRunner] HTTP 请求失败: ${url}`, error.message);
          callback(error, null, null);
        });

      // 返回取消函数
      return () => controller.abort();
    }
  }

  /**
   * 获取音乐 URL
   */
  async getMusicUrl(
    source: LxSourceKey,
    musicInfo: LxMusicInfo,
    quality: LxQuality
  ): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.requestHandler) {
      throw new Error('脚本未注册请求处理器');
    }

    const sourceConfig = this.sources[source];
    if (!sourceConfig) {
      throw new Error(`脚本不支持音源: ${source}`);
    }

    if (!sourceConfig.actions.includes('musicUrl')) {
      throw new Error(`音源 ${source} 不支持获取音乐 URL`);
    }

    // 选择最佳音质
    let targetQuality = quality;
    if (!sourceConfig.qualitys.includes(quality)) {
      // 按优先级选择可用音质
      const qualityPriority: LxQuality[] = ['flac24bit', 'flac', '320k', '128k'];
      for (const q of qualityPriority) {
        if (sourceConfig.qualitys.includes(q)) {
          targetQuality = q;
          break;
        }
      }
    }

    console.log(`[LxMusicRunner] 请求音乐 URL: 音源=${source}, 音质=${targetQuality}`);

    try {
      const result = await this.requestHandler({
        source,
        action: 'musicUrl',
        info: {
          type: targetQuality,
          musicInfo
        }
      });

      console.log(`[LxMusicRunner] 脚本返回结果:`, result, typeof result);

      // 脚本可能返回对象或字符串
      let url: string | undefined;
      if (typeof result === 'string') {
        url = result;
      } else if (result && typeof result === 'object') {
        // 某些脚本可能返回 { url: '...' } 格式
        url = result.url || result.data || result;
      }

      if (typeof url !== 'string' || !url) {
        // 如果脚本返回 undefined，尝试使用缓存的 URL
        if (this.lastMusicUrl) {
          console.log('[LxMusicRunner] 脚本返回 undefined，使用缓存的 URL');
          url = this.lastMusicUrl;
          this.lastMusicUrl = null; // 清除缓存
        } else {
          console.error('[LxMusicRunner] 无效的返回值:', result);
          throw new Error(result?.message || result?.msg || '获取音乐 URL 失败');
        }
      }

      console.log('[LxMusicRunner] 获取到 URL:', url.substring(0, 80) + '...');
      return url;
    } catch (error) {
      console.error('[LxMusicRunner] 获取音乐 URL 失败:', error);
      throw error;
    }
  }

  /**
   * 获取歌词
   */
  async getLyric(source: LxSourceKey, musicInfo: LxMusicInfo): Promise<LxLyricResult | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.requestHandler) {
      return null;
    }

    const sourceConfig = this.sources[source];
    if (!sourceConfig || !sourceConfig.actions.includes('lyric')) {
      return null;
    }

    try {
      const result = await this.requestHandler({
        source,
        action: 'lyric',
        info: {
          type: null,
          musicInfo
        }
      });

      return result as LxLyricResult;
    } catch (error) {
      console.error('[LxMusicRunner] 获取歌词失败:', error);
      return null;
    }
  }

  /**
   * 获取封面图
   */
  async getPic(source: LxSourceKey, musicInfo: LxMusicInfo): Promise<string | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.requestHandler) {
      return null;
    }

    const sourceConfig = this.sources[source];
    if (!sourceConfig || !sourceConfig.actions.includes('pic')) {
      return null;
    }

    try {
      const url = await this.requestHandler({
        source,
        action: 'pic',
        info: {
          type: null,
          musicInfo
        }
      });

      return typeof url === 'string' ? url : null;
    } catch (error) {
      console.error('[LxMusicRunner] 获取封面失败:', error);
      return null;
    }
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// 全局单例
let runnerInstance: LxMusicSourceRunner | null = null;

/**
 * 获取落雪音源执行器实例
 */
export const getLxMusicRunner = (): LxMusicSourceRunner | null => {
  return runnerInstance;
};

/**
 * 设置落雪音源执行器实例
 */
export const setLxMusicRunner = (runner: LxMusicSourceRunner | null): void => {
  runnerInstance = runner;
};

/**
 * 初始化落雪音源执行器（从脚本内容）
 */
export const initLxMusicRunner = async (script: string): Promise<LxMusicSourceRunner> => {
  // 销毁旧实例
  runnerInstance = null;

  // 创建新实例
  const runner = new LxMusicSourceRunner(script);
  await runner.initialize();

  runnerInstance = runner;
  return runner;
};

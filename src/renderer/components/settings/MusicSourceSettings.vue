<template>
  <n-modal
    v-model:show="visible"
    preset="dialog"
    :title="t('settings.playback.musicSources')"
    :positive-text="t('common.confirm')"
    :negative-text="t('common.cancel')"
    class="music-source-modal"
    @positive-click="handleConfirm"
    @negative-click="handleCancel"
    style="width: 800px; max-width: 90vw"
  >
    <div class="h-[400px]">
      <n-tabs type="segment" animated class="h-full flex flex-col">
        <!-- Tab 1: 音源选择 -->
        <n-tab-pane name="sources" tab="音源选择" class="h-full overflow-y-auto">
          <n-space vertical :size="20" class="pt-4 pr-2">
            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ t('settings.playback.musicSourcesDesc') }}
            </p>

            <!-- 音源卡片列表 -->
            <div class="music-sources-grid">
              <div
                v-for="source in MUSIC_SOURCES"
                :key="source.key"
                class="source-card"
                :class="{
                  'source-card--selected': isSourceSelected(source.key),
                  'source-card--disabled': source.disabled && !isSourceSelected(source.key)
                }"
                :style="{ '--source-color': source.color }"
                @click="toggleSource(source.key)"
              >
                <div class="source-card__indicator"></div>
                <div class="source-card__content">
                  <div class="source-card__header">
                    <span class="source-card__name">{{ source.key }}</span>
                    <n-icon
                      v-if="isSourceSelected(source.key)"
                      size="18"
                      class="source-card__check"
                    >
                      <i class="ri-checkbox-circle-fill"></i>
                    </n-icon>
                  </div>
                  <p v-if="source.description" class="source-card__description">
                    {{ source.description }}
                  </p>
                </div>
              </div>

              <!-- 落雪音源卡片 (仅开关) -->
              <div
                class="source-card source-card--lxmusic"
                :class="{
                  'source-card--selected': isSourceSelected('lxMusic'),
                  'source-card--disabled': !settingsStore.setData.lxMusicScript
                }"
                style="--source-color: #10b981"
                @click="toggleSource('lxMusic')"
              >
                <div class="source-card__indicator"></div>
                <div class="source-card__content">
                  <div class="source-card__header">
                    <span class="source-card__name">落雪音源</span>
                    <n-icon v-if="isSourceSelected('lxMusic')" size="18" class="source-card__check">
                      <i class="ri-checkbox-circle-fill"></i>
                    </n-icon>
                  </div>
                  <p class="source-card__description">
                    {{
                      settingsStore.setData.lxMusicScript
                        ? lxMusicScriptInfo?.name || '已导入'
                        : '未导入 (请去落雪音源Tab配置)'
                    }}
                  </p>
                </div>
              </div>

              <!-- 自定义API卡片 (仅开关) -->
              <div
                class="source-card source-card--custom"
                :class="{
                  'source-card--selected': isSourceSelected('custom'),
                  'source-card--disabled': !settingsStore.setData.customApiPlugin
                }"
                style="--source-color: #8b5cf6"
                @click="toggleSource('custom')"
              >
                <div class="source-card__indicator"></div>
                <div class="source-card__content">
                  <div class="source-card__header">
                    <span class="source-card__name">{{
                      t('settings.playback.sourceLabels.custom')
                    }}</span>
                    <n-icon v-if="isSourceSelected('custom')" size="18" class="source-card__check">
                      <i class="ri-checkbox-circle-fill"></i>
                    </n-icon>
                  </div>
                  <p class="source-card__description">
                    {{
                      settingsStore.setData.customApiPlugin
                        ? t('settings.playback.customApi.status.imported')
                        : t('settings.playback.customApi.status.notImported')
                    }}
                  </p>
                </div>
              </div>
            </div>
          </n-space>
        </n-tab-pane>

        <!-- Tab 2: 落雪音源管理 -->
        <n-tab-pane name="lxMusic" tab="落雪音源" class="h-full overflow-y-auto">
          <div class="pt-4 pr-2">
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-base font-medium">已导入的音源脚本</h3>
              <div class="flex gap-2">
                <n-button @click="importLxMusicScript" size="small" secondary type="success">
                  <template #icon>
                    <n-icon><i class="ri-upload-line"></i></n-icon>
                  </template>
                  本地导入
                </n-button>
              </div>
            </div>

            <!-- 已导入的音源列表 -->
            <div v-if="lxMusicApis.length > 0" class="lx-api-list mb-4">
              <div
                v-for="api in lxMusicApis"
                :key="api.id"
                class="lx-api-item"
                :class="{ 'lx-api-item--active': activeLxApiId === api.id }"
              >
                <div class="lx-api-item__radio">
                  <n-radio
                    :checked="activeLxApiId === api.id"
                    @update:checked="() => setActiveLxApi(api.id)"
                  />
                </div>
                <div class="lx-api-item__info">
                  <div class="flex items-center gap-2">
                    <span class="lx-api-item__name" v-if="editingScriptId !== api.id">{{
                      api.name
                    }}</span>
                    <n-input
                      v-else
                      v-model:value="editingName"
                      size="tiny"
                      class="w-32"
                      ref="renameInputRef"
                      @blur="saveScriptName(api.id)"
                      @keyup.enter="saveScriptName(api.id)"
                    />

                    <n-button
                      v-if="editingScriptId !== api.id"
                      text
                      size="tiny"
                      @click="startRenaming(api)"
                    >
                      <template #icon>
                        <n-icon class="text-gray-400 hover:text-primary"
                          ><i class="ri-edit-line"></i
                        ></n-icon>
                      </template>
                    </n-button>
                  </div>
                  <span v-if="api.info.version" class="lx-api-item__version"
                    >v{{ api.info.version }}</span
                  >
                </div>
                <div class="lx-api-item__actions">
                  <n-button text size="tiny" type="error" @click="removeLxApi(api.id)">
                    <template #icon>
                      <n-icon><i class="ri-close-line"></i></n-icon>
                    </template>
                  </n-button>
                </div>
              </div>
            </div>
            <div v-else class="empty-state">
              <n-empty description="暂无已导入的落雪音源" />
            </div>

            <!-- URL 导入区域 -->
            <div class="mt-6">
              <h4 class="text-sm font-medium mb-2 text-gray-600 dark:text-gray-400">在线导入</h4>
              <div class="flex items-center gap-2">
                <n-input
                  v-model:value="lxScriptUrl"
                  placeholder="输入落雪音源脚本 URL"
                  size="small"
                  class="flex-1"
                  :disabled="isImportingFromUrl"
                />
                <n-button
                  @click="importLxMusicScriptFromUrl"
                  size="small"
                  type="primary"
                  :loading="isImportingFromUrl"
                  :disabled="!lxScriptUrl.trim()"
                >
                  <template #icon>
                    <n-icon><i class="ri-download-line"></i></n-icon>
                  </template>
                  导入
                </n-button>
              </div>
            </div>
          </div>
        </n-tab-pane>

        <!-- Tab 3: 自定义API管理 -->
        <n-tab-pane name="customApi" tab="自定义API" class="h-full overflow-y-auto">
          <div class="pt-4 flex flex-col items-center justify-center h-full gap-4">
            <div class="text-center">
              <h3 class="text-lg font-medium mb-2">
                {{ t('settings.playback.customApi.sectionTitle') }}
              </h3>
              <p class="text-gray-500 text-sm mb-4">导入兼容的自定义 API 插件以扩展音源</p>
            </div>

            <div class="flex flex-col items-center gap-2">
              <n-button @click="importPlugin" type="primary" secondary>
                <template #icon>
                  <n-icon><i class="ri-upload-line"></i></n-icon>
                </template>
                {{ t('settings.playback.customApi.importConfig') }}
              </n-button>

              <p
                v-if="settingsStore.setData.customApiPluginName"
                class="text-green-600 text-sm mt-2 flex items-center gap-1"
              >
                <i class="ri-check-circle-line"></i>
                {{ t('settings.playback.customApi.currentSource') }}:
                <span class="font-semibold">{{ settingsStore.setData.customApiPluginName }}</span>
              </p>
              <p v-else class="text-gray-400 text-sm mt-2">
                {{ t('settings.playback.customApi.notImported') }}
              </p>
            </div>
          </div>
        </n-tab-pane>
      </n-tabs>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { useMessage } from 'naive-ui';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  initLxMusicRunner,
  parseScriptInfo,
  setLxMusicRunner
} from '@/services/LxMusicSourceRunner';
import { useSettingsStore } from '@/store';
import type { LxMusicScriptConfig, LxScriptInfo, LxSourceKey } from '@/types/lxMusic';
import { type Platform } from '@/types/music';

// ==================== 类型定义 ====================
type ExtendedPlatform = Platform | 'custom' | 'lxMusic';

interface MusicSourceConfig {
  key: string;
  description?: string;
  color: string;
  disabled?: boolean;
}

// ==================== 音源配置 ====================
const MUSIC_SOURCES: MusicSourceConfig[] = [
  { key: 'migu', color: '#ff6600' },
  { key: 'kugou', color: '#2979ff' },
  { key: 'kuwo', color: '#ff8c00' },
  { key: 'pyncmd', color: '#ec4141' },
  { key: 'bilibili', color: '#00a1d6' }
];

// ==================== Props & Emits ====================
const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  sources: {
    type: Array as () => ExtendedPlatform[],
    default: () => ['migu', 'kugou', 'kuwo', 'pyncmd', 'bilibili'] as ExtendedPlatform[]
  }
});

const emit = defineEmits(['update:show', 'update:sources']);

// ==================== 状态管理 ====================
const { t } = useI18n();
const settingsStore = useSettingsStore();
const message = useMessage();
const visible = ref(props.show);
const selectedSources = ref<ExtendedPlatform[]>([...props.sources]);

// 落雪音源列表（从 store 中的脚本解析）
const lxMusicApis = computed<LxMusicScriptConfig[]>(() => {
  const scripts = settingsStore.setData.lxMusicScripts || [];
  return scripts;
});

// 当前激活的音源 ID
const activeLxApiId = computed<string | null>({
  get: () => settingsStore.setData.activeLxMusicApiId || null,
  set: (id) => {
    settingsStore.setSetData({ activeLxMusicApiId: id });
  }
});

// 落雪音源脚本信息（保持向后兼容）
const lxMusicScriptInfo = computed<LxScriptInfo | null>(() => {
  const activeId = activeLxApiId.value;
  if (!activeId) return null;
  const activeApi = lxMusicApis.value.find((api) => api.id === activeId);
  return activeApi?.info || null;
});

// URL 导入相关状态
const lxScriptUrl = ref('');
const isImportingFromUrl = ref(false);

// 重命名相关状态
const editingScriptId = ref<string | null>(null);
const editingName = ref('');
const renameInputRef = ref<HTMLInputElement | null>(null);

// ==================== 计算属性 ====================
const isSourceSelected = (sourceKey: string): boolean => {
  return selectedSources.value.includes(sourceKey as ExtendedPlatform);
};

// ==================== 方法 ====================
/**
 * 切换音源选择状态
 */
const toggleSource = (sourceKey: string) => {
  // 检查是否是自定义API且未导入
  if (sourceKey === 'custom' && !settingsStore.setData.customApiPlugin) {
    message.warning(t('settings.playback.customApi.enableHint'));
    return;
  }

  // 检查是否是落雪音源且未导入
  if (sourceKey === 'lxMusic' && !settingsStore.setData.lxMusicScript) {
    message.warning('请先导入落雪音源脚本');
    return;
  }

  const index = selectedSources.value.indexOf(sourceKey as ExtendedPlatform);
  if (index > -1) {
    // 至少保留一个音源
    if (selectedSources.value.length <= 1) {
      message.warning(t('settings.playback.musicSourcesMinWarning'));
      return;
    }
    selectedSources.value.splice(index, 1);
  } else {
    selectedSources.value.push(sourceKey as ExtendedPlatform);
  }
};

/**
 * 导入自定义API插件
 */
const importPlugin = async () => {
  try {
    const result = await window.api.importCustomApiPlugin();
    if (result && result.name && result.content) {
      settingsStore.setCustomApiPlugin(result);
      message.success(t('settings.playback.customApi.importSuccess', { name: result.name }));

      // 导入成功后自动勾选
      if (!selectedSources.value.includes('custom')) {
        selectedSources.value.push('custom');
      }
    }
  } catch (error: any) {
    message.error(t('settings.playback.customApi.importFailed', { message: error.message }));
  }
};

/**
 * 导入落雪音源脚本
 */
const importLxMusicScript = async () => {
  try {
    const result = await window.api.importLxMusicScript();
    if (result && result.content) {
      await addLxMusicScript(result.content);
    }
  } catch (error: any) {
    console.error('导入落雪音源脚本失败:', error);
    message.error(`导入失败：${error.message}`);
  }
};

/**
 * 添加落雪音源脚本到列表
 */
const addLxMusicScript = async (scriptContent: string) => {
  // 解析脚本信息
  const scriptInfo = parseScriptInfo(scriptContent);

  // 尝试初始化执行器以验证脚本
  try {
    const runner = await initLxMusicRunner(scriptContent);
    const sources = runner.getSources();
    const sourceKeys = Object.keys(sources) as LxSourceKey[];

    // 生成唯一 ID
    const id = `lx_api_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 创建新的脚本配置
    const newApiConfig: LxMusicScriptConfig = {
      id,
      name: scriptInfo.name,
      script: scriptContent,
      info: scriptInfo,
      sources: sourceKeys,
      enabled: true,
      createdAt: Date.now()
    };

    // 添加到列表
    const scripts = [...(settingsStore.setData.lxMusicScripts || []), newApiConfig];

    settingsStore.setSetData({
      lxMusicScripts: scripts,
      activeLxMusicApiId: id // 自动激活新添加的音源
    });

    message.success(`音源脚本导入成功：${scriptInfo.name}，支持 ${sourceKeys.length} 个音源`);

    // 导入成功后自动勾选
    if (!selectedSources.value.includes('lxMusic')) {
      selectedSources.value.push('lxMusic');
    }
  } catch (initError: any) {
    console.error('落雪音源脚本初始化失败:', initError);
    message.error(`脚本初始化失败：${initError.message}`);
  }
};

/**
 * 设置激活的落雪音源
 */
const setActiveLxApi = async (apiId: string) => {
  const api = lxMusicApis.value.find((a) => a.id === apiId);
  if (!api) {
    message.error('音源不存在');
    return;
  }

  try {
    // 初始化选中的脚本
    await initLxMusicRunner(api.script);

    // 更新激活的音源 ID
    activeLxApiId.value = apiId;

    // 确保 lxMusic 在已选音源中
    if (!selectedSources.value.includes('lxMusic')) {
      selectedSources.value.push('lxMusic');
    }

    message.success(`已切换到音源: ${api.name}`);
  } catch (error: any) {
    console.error('切换落雪音源失败:', error);
    message.error(`切换失败：${error.message}`);
  }
};

/**
 * 删除落雪音源
 */
const removeLxApi = (apiId: string) => {
  const scripts = [...(settingsStore.setData.lxMusicScripts || [])];
  const index = scripts.findIndex((s) => s.id === apiId);

  if (index === -1) return;

  const removedScript = scripts[index];
  scripts.splice(index, 1);

  // 更新 store
  settingsStore.setSetData({
    lxMusicScripts: scripts
  });

  // 如果删除的是当前激活的音源
  if (activeLxApiId.value === apiId) {
    // 自动选择下一个可用音源，或者清空
    if (scripts.length > 0) {
      setActiveLxApi(scripts[0].id);
    } else {
      setLxMusicRunner(null);
      settingsStore.setSetData({ activeLxMusicApiId: null });
      // 从已选音源中移除 lxMusic
      const srcIndex = selectedSources.value.indexOf('lxMusic');
      if (srcIndex > -1) {
        selectedSources.value.splice(srcIndex, 1);
      }
    }
  }

  message.success(`已删除音源: ${removedScript.name}`);
};

/**
 * 从 URL 导入落雪音源脚本
 */
const importLxMusicScriptFromUrl = async () => {
  const url = lxScriptUrl.value.trim();
  if (!url) {
    message.warning('请输入脚本 URL');
    return;
  }

  // 验证 URL 格式
  try {
    new URL(url);
  } catch {
    message.error('无效的 URL 格式');
    return;
  }

  isImportingFromUrl.value = true;

  try {
    // 下载脚本内容
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();

    // 验证脚本格式
    if (
      !content.includes('globalThis.lx') &&
      !content.includes('lx.on') &&
      !content.includes('EVENT_NAMES')
    ) {
      throw new Error('无效的落雪音源脚本，未找到 globalThis.lx 相关代码');
    }

    // 使用统一的添加方法
    await addLxMusicScript(content);

    // 清空 URL 输入框
    lxScriptUrl.value = '';
  } catch (error: any) {
    console.error('从 URL 导入落雪音源脚本失败:', error);
    message.error(`在线导入失败：${error.message}`);
  } finally {
    isImportingFromUrl.value = false;
  }
};

/**
 * 开始重命名
 */
const startRenaming = (api: LxMusicScriptConfig) => {
  editingScriptId.value = api.id;
  editingName.value = api.name;
  nextTick(() => {
    renameInputRef.value?.focus();
  });
};

/**
 * 保存脚本名称
 */
const saveScriptName = (apiId: string) => {
  if (!editingName.value.trim()) {
    message.warning('名称不能为空');
    return;
  }

  const scripts = [...(settingsStore.setData.lxMusicScripts || [])];
  const index = scripts.findIndex((s) => s.id === apiId);

  if (index > -1) {
    scripts[index] = {
      ...scripts[index],
      name: editingName.value.trim()
    };

    settingsStore.setSetData({
      lxMusicScripts: scripts
    });

    message.success('重命名成功');
  }

  editingScriptId.value = null;
  editingName.value = '';
};

/**
 * 确认选择
 */
const handleConfirm = () => {
  const defaultPlatforms: ExtendedPlatform[] = ['migu', 'kugou', 'kuwo', 'pyncmd', 'bilibili'];
  const valuesToEmit =
    selectedSources.value.length > 0 ? [...new Set(selectedSources.value)] : defaultPlatforms;
  emit('update:sources', valuesToEmit);
  visible.value = false;
};

/**
 * 取消选择
 */
const handleCancel = () => {
  selectedSources.value = [...props.sources];
  visible.value = false;
};

// ==================== 监听器 ====================
// 监听自定义插件内容变化
watch(
  () => settingsStore.setData.customApiPlugin,
  (newPluginContent) => {
    if (!newPluginContent) {
      const index = selectedSources.value.indexOf('custom');
      if (index > -1) {
        selectedSources.value.splice(index, 1);
      }
    }
  }
);

// 同步外部show属性变化
watch(
  () => props.show,
  (newVal) => {
    visible.value = newVal;
  }
);

// 同步内部visible变化
watch(
  () => visible.value,
  (newVal) => {
    emit('update:show', newVal);
  }
);

// 同步外部sources属性变化
watch(
  () => props.sources,
  (newVal) => {
    selectedSources.value = [...newVal];
  },
  { deep: true }
);
</script>

<style lang="scss" scoped>
.music-sources-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}

.source-card {
  position: relative;
  border-radius: 8px;
  border: 2px solid transparent;
  background:
    linear-gradient(white, white) padding-box,
    linear-gradient(135deg, var(--source-color, #ddd) 0%, transparent 100%) border-box;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--source-color);
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  &__indicator {
    position: absolute;
    top: 0;
    left: 0;
    width: 4px;
    height: 100%;
    background: var(--source-color);
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  &__content {
    position: relative;
    z-index: 1;
  }

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  &__name {
    font-size: 15px;
    font-weight: 600;
    color: #333;
    transition: color 0.2s ease;
  }

  &__check {
    color: var(--source-color);
    opacity: 0;
    transform: scale(0.8);
    transition: all 0.2s ease;
  }

  &__description {
    font-size: 12px;
    color: #999;
    margin: 0;
    transition: color 0.2s ease;
  }

  &:hover {
    border-color: var(--source-color);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }

  &--selected {
    border-color: var(--source-color);
    background:
      linear-gradient(white, white) padding-box,
      var(--source-color) border-box;

    .source-card__indicator {
      opacity: 1;
    }

    .source-card__check {
      opacity: 1;
      transform: scale(1);
    }

    &::before {
      opacity: 0.05;
    }
  }

  &--disabled {
    opacity: 0.5;
    cursor: not-allowed;

    &:hover {
      transform: none;
      box-shadow: none;
    }
  }
}

// 深色模式适配
:global(.dark) {
  .source-card {
    background:
      linear-gradient(#1f1f1f, #1f1f1f) padding-box,
      linear-gradient(135deg, var(--source-color, #555) 0%, transparent 100%) border-box;

    &__name {
      color: #e5e5e5;
    }

    &__description {
      color: #999;
    }

    &--selected {
      background:
        linear-gradient(#1f1f1f, #1f1f1f) padding-box,
        var(--source-color) border-box;
    }
  }
}

.lx-api-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lx-api-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: #f5f5f5;
  border-radius: 8px;
  border: 1px solid transparent;
  transition: all 0.2s ease;

  &--active {
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(59, 130, 246, 0.08));
    border-color: rgba(16, 185, 129, 0.3);
  }

  &__radio {
    flex-shrink: 0;
  }

  &__info {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__name {
    font-size: 13px;
    font-weight: 500;
    color: #333;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__version {
    font-size: 12px;
    color: #999;
    background: rgba(0, 0, 0, 0.05);
    padding: 1px 6px;
    border-radius: 4px;
  }

  &__actions {
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  &:hover &__actions {
    opacity: 1;
  }
}

:global(.dark) {
  .lx-api-item {
    background: #2a2a2a;

    &__name {
      color: #e5e5e5;
    }

    &__version {
      background: rgba(255, 255, 255, 0.1);
    }
  }
}

.empty-state {
  padding: 32px 0;
  display: flex;
  justify-content: center;
}
</style>

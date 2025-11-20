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
    <n-space vertical :size="20">
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
              <n-icon v-if="isSourceSelected(source.key)" size="18" class="source-card__check">
                <i class="ri-checkbox-circle-fill"></i>
              </n-icon>
            </div>
            <p v-if="source.description" class="source-card__description">
              {{ source.description }}
            </p>
          </div>
        </div>

        <!-- 自定义API卡片 -->
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

      <!-- 分割线 -->
      <div class="divider"></div>

      <!-- 自定义API导入区域 -->
      <div class="custom-api-section">
        <h3 class="custom-api-section__title">
          {{ t('settings.playback.customApi.sectionTitle') }}
        </h3>
        <div class="custom-api-section__content">
          <n-button @click="importPlugin" size="small" secondary>
            <template #icon>
              <n-icon><i class="ri-upload-line"></i></n-icon>
            </template>
            {{ t('settings.playback.customApi.importConfig') }}
          </n-button>
          <p v-if="settingsStore.setData.customApiPluginName" class="custom-api-section__status">
            {{ t('settings.playback.customApi.currentSource') }}:
            <span class="font-semibold">{{ settingsStore.setData.customApiPluginName }}</span>
          </p>
          <p v-else class="custom-api-section__status custom-api-section__status--empty">
            {{ t('settings.playback.customApi.notImported') }}
          </p>
        </div>
      </div>
    </n-space>
  </n-modal>
</template>

<script setup lang="ts">
import { useMessage } from 'naive-ui';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useSettingsStore } from '@/store';
import { type Platform } from '@/types/music';

// ==================== 类型定义 ====================
type ExtendedPlatform = Platform | 'custom';

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

.divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, #e5e5e5 50%, transparent);
  margin: 8px 0;
}

:global(.dark) .divider {
  background: linear-gradient(90deg, transparent, #333 50%, transparent);
}

.custom-api-section {
  &__title {
    font-size: 14px;
    font-weight: 600;
    color: #333;
    margin-bottom: 12px;
  }

  &__content {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  &__status {
    font-size: 13px;
    color: #666;
    margin: 0;

    &--empty {
      color: #999;
    }
  }
}

:global(.dark) .custom-api-section {
  &__title {
    color: #e5e5e5;
  }

  &__status {
    color: #999;

    &--empty {
      color: #666;
    }
  }
}
</style>

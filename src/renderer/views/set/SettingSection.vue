<template>
  <div :id="id" :ref="setRef" class="mb-6 scroll-mt-4">
    <!-- 分组标题 -->
    <div class="text-base font-medium mb-4 text-gray-600 dark:text-white">
      <slot name="title">{{ title }}</slot>
    </div>

    <!-- 设置项列表 -->
    <div class="space-y-4 max-md:space-y-3">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { type ComponentPublicInstance } from 'vue';

defineOptions({
  name: 'SettingSection'
});

interface Props {
  /** 分组 ID，用于导航定位 */
  id?: string;
  /** 分组标题 */
  title?: string;
}

withDefaults(defineProps<Props>(), {
  id: '',
  title: ''
});

const emit = defineEmits<{
  ref: [el: Element | null];
}>();

// 暴露 ref 给父组件
const setRef = (el: Element | ComponentPublicInstance | null) => {
  emit('ref', el as Element | null);
};
</script>

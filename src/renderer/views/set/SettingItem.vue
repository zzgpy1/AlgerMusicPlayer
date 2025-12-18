<template>
  <div
    class="flex items-center justify-between p-4 rounded-lg transition-all bg-light dark:bg-dark text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 hover:bg-gray-50 hover:dark:bg-gray-800"
    :class="[
      // 移动端垂直布局
      { 'max-md:flex-col max-md:items-start max-md:gap-3 max-md:p-3': !inline },
      // 可点击样式
      {
        'cursor-pointer hover:text-green-500 hover:!bg-green-50 hover:dark:!bg-green-900/30':
          clickable
      },
      customClass
    ]"
    @click="handleClick"
  >
    <!-- 左侧：标题和描述 -->
    <div class="flex-1 min-w-0">
      <div class="text-base font-medium mb-1">
        <slot name="title">{{ title }}</slot>
      </div>
      <div
        v-if="description || $slots.description"
        class="text-sm text-gray-500 dark:text-gray-400"
      >
        <slot name="description">{{ description }}</slot>
      </div>
      <!-- 额外内容插槽 -->
      <slot name="extra"></slot>
    </div>

    <!-- 右侧：操作区 -->
    <div
      v-if="$slots.action || $slots.default"
      class="flex items-center gap-2 flex-shrink-0"
      :class="{ 'max-md:w-full max-md:justify-end': !inline }"
    >
      <slot name="action">
        <slot></slot>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({
  name: 'SettingItem'
});

interface Props {
  /** 设置项标题 */
  title?: string;
  /** 设置项描述 */
  description?: string;
  /** 是否可点击 */
  clickable?: boolean;
  /** 是否保持水平布局（不响应移动端） */
  inline?: boolean;
  /** 自定义类名 */
  customClass?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  description: '',
  clickable: false,
  inline: false,
  customClass: ''
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const handleClick = (event: MouseEvent) => {
  if (props.clickable) {
    emit('click', event);
  }
};
</script>

export type SceneNotificationKey =
  'busy' | 'fallback' | 'success' | 'partial' | 'failed'

export const sceneNotifications: Record<
  'en' | 'zh-CN',
  Record<SceneNotificationKey, string>
> = {
  en: {
    busy: 'A scene is already running.',
    fallback: 'Using fallback display assignments.',
    success: 'Scene completed successfully.',
    partial: 'Scene completed with some problems.',
    failed: 'Scene failed.',
  },
  'zh-CN': {
    busy: '已有场景正在运行。',
    fallback: '正在使用备用屏幕分配。',
    success: '场景运行成功。',
    partial: '场景已运行，但部分操作出现问题。',
    failed: '场景运行失败。',
  },
}

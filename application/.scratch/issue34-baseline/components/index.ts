import type { App } from 'vue';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput
} from 'element-plus';

export function registerGlobalComponents(app: App) {
  app.use(ElAlert);
  app.use(ElButton);
  app.use(ElForm);
  app.use(ElFormItem);
  app.use(ElInput);
}

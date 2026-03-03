import { defineConfig } from '@umijs/max';

export default defineConfig({
  antd: {},
  access: {},
  model: {},
  initialState: {},
  request: {},
  locale: {
    default: 'zh-CN',
    antd: true,
    baseNavigator: true,
  },
  layout: {
    title: 'Gemini Chat',
  },
  routes: [
    {
      path: '/',
      redirect: '/chat',
    },
    {
      name: 'Login',
      path: '/login',
      component: './Login',
      layout: false,
    },
    {
      name: 'Chat',
      path: '/chat',
      component: './Chat',
      layout: false,
    },
  ],
  npmClient: 'npm',
  outputPath: 'dist',
  esbuildMinifyIIFE: true,
  proxy: {
    '/api': {
      target: 'http://localhost:8866',
      changeOrigin: true,
    },
  },
  tailwindcss: {},
});

import { defineConfig } from 'vitepress'
import llmstxt, { copyOrDownloadAsMarkdownButtons } from 'vitepress-plugin-llms'
import typedocSidebar from '../api/generated/typedoc-sidebar.json'

export default defineConfig({
  title: 'nestjs-odata',
  description: 'OData v4 for NestJS — zero double-declaration',
  base: '/nestjs-odata/',
  vite: {
    plugins: [llmstxt()],
  },
  markdown: {
    config(md) {
      md.use(copyOrDownloadAsMarkdownButtons)
    },
  },
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/module' },
      { text: 'Examples', link: '/examples/basic-crud' },
      { text: 'GitHub', link: 'https://github.com/nestjs-odata/nestjs-odata' },
    ],
    sidebar: {
      '/guide/': [
        { text: 'Overview', link: '/guide/' },
        { text: 'Getting Started', link: '/guide/getting-started' },
        { text: 'Configuration', link: '/guide/configuration' },
        { text: 'Query Options', link: '/guide/query-options' },
        { text: 'Filter Functions', link: '/guide/filter-functions' },
        { text: 'CRUD Operations', link: '/guide/crud' },
        { text: '$expand', link: '/guide/expand' },
        { text: '$batch', link: '/guide/batch' },
        { text: 'Security', link: '/guide/security' },
      ],
      '/api/': [
        { text: 'Overview', link: '/api/' },
        { text: 'Module API', link: '/api/module' },
        { text: 'Decorators', link: '/api/decorators' },
        { text: 'TypeORM Adapter', link: '/api/typeorm' },
        {
          text: 'Auto-generated Reference',
          items: typedocSidebar,
        },
      ],
      '/examples/': [
        { text: 'Overview', link: '/examples/' },
        { text: 'Basic CRUD', link: '/examples/basic-crud' },
        { text: 'Custom Controller', link: '/examples/custom-controller' },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/nestjs-odata/nestjs-odata' }],
  },
})

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
      { text: 'GitHub', link: 'https://github.com/cberd1509/nestjs-odata' },
    ],
    sidebar: {
      '/guide/': [
        { text: 'Overview', link: '/guide/' },
        { text: 'Getting Started', link: '/guide/getting-started' },
        { text: 'Configuration', link: '/guide/configuration' },
        { text: 'EDM & $metadata', link: '/guide/metadata' },
        { text: 'Query Options', link: '/guide/query-options' },
        { text: 'Filter Functions', link: '/guide/filter-functions' },
        { text: 'CRUD Operations', link: '/guide/crud' },
        { text: '$expand', link: '/guide/expand' },
        { text: '$batch', link: '/guide/batch' },
        { text: 'Security', link: '/guide/security' },
        { text: 'Request Validation', link: '/guide/validation' },
        { text: 'Troubleshooting', link: '/guide/troubleshooting' },
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
        { text: 'E-Commerce', link: '/examples/e-commerce' },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/cberd1509/nestjs-odata' }],
  },
})

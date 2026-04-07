import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'nestjs-odata',
  description: 'OData v4 for NestJS — zero double-declaration',
  base: '/nestjs-odata/',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/module' },
      { text: 'Examples', link: '/examples/basic-crud' },
      { text: 'GitHub', link: 'https://github.com/nestjs-odata/nestjs-odata' },
    ],
    sidebar: {
      '/guide/': [
        { text: 'Getting Started', link: '/guide/getting-started' },
        { text: 'Configuration', link: '/guide/configuration' },
        { text: 'Query Options', link: '/guide/query-options' },
        { text: 'CRUD Operations', link: '/guide/crud' },
        { text: '$expand', link: '/guide/expand' },
        { text: '$batch', link: '/guide/batch' },
        { text: 'Security', link: '/guide/security' },
      ],
      '/api/': [
        { text: 'Module API', link: '/api/module' },
        { text: 'Decorators', link: '/api/decorators' },
      ],
      '/examples/': [
        { text: 'Basic CRUD', link: '/examples/basic-crud' },
        { text: 'Custom Controller', link: '/examples/custom-controller' },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/nestjs-odata/nestjs-odata' },
    ],
  },
})

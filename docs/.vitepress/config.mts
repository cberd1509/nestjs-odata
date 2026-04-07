import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'nestjs-odata',
  description: 'OData v4 library for NestJS — zero double-declaration',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'API', link: '/api/' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/guide/' },
            { text: 'Quick Start', link: '/guide/quick-start' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/your-org/nestjs-odata' }],
  },
})

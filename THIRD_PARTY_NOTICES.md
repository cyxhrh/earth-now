# 第三方素材与内容

## 地球影像

`public/textures/earth-blue-ocean-8k.jpg` 来自 NASA Earth Observatory 的 Blue Marble: Next Generation，2004 年 9 月地形与海底地形合成图；本项目缩放为 8192×4096，不代表当前天气或实时海洋状态。`earth-blue-marble.jpg` 为旧版小图，保留出处。详情见 [纹理清单](public/textures/ATTRIBUTION.md)。

NASA 的使用指南允许在相应条件下作信息展示并要求标明来源；第三方署名素材有自己的权利条件。本项目不使用 NASA 标识作为品牌，不暗示 NASA 认可或合作。参见 [NASA Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)。这些素材不重新授予 MIT 许可。

## 演示内容

`src/features/news/mock.ts` 的故事均为虚构交互样本；`public/demo/*.svg` 为本项目原创示意图，不是事件现场照片。原创演示文字与插图随项目采用 MIT 许可。`docs/assets/demo-*.png` 为演示模式截图，包含上述原创内容和已注明来源的地球影像。

## 真实新闻

仓库不附带作者采集的新闻数据库、译文缓存或独立的原媒体照片文件。`docs/assets/live-globe.jpg` 是 2026-09-19 的真实新闻界面截图，仅用于展示软件界面；其中新闻标题、缩略图及标识来自画面标注的中新网、CGTN、卫报等发布方，相关权利归原权利人，不适用本项目 MIT 许可。

用户运行采集器时访问的文章、摘要、图片和商标仍归原权利人。本项目 MIT 许可证只授权项目代码和原创内容，不代表所有来源允许任意转载或商业使用。保留来源、时间、原文链接，并依据各来源条款使用。

## 软件依赖

第三方软件保持各自许可证；锁定版本见 `package-lock.json`。React、Three.js、Globe.gl、PGlite、pg、Zod、Vite、rss-parser、Cheerio、Lucide 等由各自社区维护，安装包内的 LICENSE / NOTICE 为具体版本依据。发布包含依赖的构建产物时也应保留所需许可声明。

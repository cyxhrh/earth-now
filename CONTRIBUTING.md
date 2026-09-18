# 参与贡献

欢迎提交可复现问题、来源适配、翻译质量修复和地球交互改进。开始前阅读 [架构与扩展](docs/architecture.md)。较大范围改动先开 Issue 说明使用场景；V1 暂以桌面和三栏目为核心。

```sh
npm ci
npm run demo
npm run lint
npm test
npm run build
npm run smoke
```

分支提交应围绕一个问题。行为变化附回归测试，UI 变化附演示模式截图，注明操作系统、Node 和浏览器版本。来源测试用最小合成 RSS/HTML，不把完整真实报道或个人数据库加入 fixture。

格式使用 Prettier；只格式化涉及文件，避免无关大改。不要提交 `.env.*` 实际配置、密钥、日志、`data/`、`output/` 或未经授权素材。测试不得使用付费模型或依赖当日真实新闻。提交 PR 时说明验证方法及未验证的边界。

贡献的原创代码按本仓库 MIT 许可证提供；引入第三方内容时同时提供其出处与适用许可。

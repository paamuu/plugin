# Angular Schematics VSCode 插件

这是一个用于在 Angular 项目中快速生成原理图的 VSCode 插件。

## 功能特性

- 🎯 **智能检测**: 只在 Angular 项目中显示右键菜单
- 📋 **可视化选择**: 通过弹出框选择要生成的 Angular 原理图
- ✏️ **名称输入**: 为每个 schematic 输入自定义名称
- ⚙️ **选项配置**: 根据不同的 schematic 类型提供相应的配置选项
- 🚀 **快速生成**: 一键生成 Angular 组件、服务、管道等

## 支持的 Schematics

- **component** - 生成组件
- **service** - 生成服务
- **pipe** - 生成管道
- **directive** - 生成指令
- **module** - 生成模块
- **class** - 生成类
- **interface** - 生成接口
- **enum** - 生成枚举
- **guard** - 生成路由守卫
- **resolver** - 生成路由解析器
- **interceptor** - 生成 HTTP 拦截器

## 使用方法

1. **安装插件**: 在 VSCode 中安装此插件
2. **打开 Angular 项目**: 确保项目根目录包含 `angular.json` 文件
3. **右键菜单**: 在文件资源管理器中右键点击 `angular.json` 文件
4. **选择命令**: 点击 "Angular 原理图" 菜单项
5. **选择 Schematic**: 在弹出的选择器中选择要生成的原理图类型
6. **输入名称**: 为生成的文件输入名称
7. **配置选项**: 根据需要配置额外的选项（如是否创建测试文件等）
8. **完成生成**: 插件将自动生成相应的文件

## 开发环境设置

### 前提条件

- Node.js (版本 16 或更高)
- npm 或 yarn
- VSCode

### 安装依赖

```bash
npm install
```

### 编译

```bash
npm run compile
```

### 使用 esbuild 构建

```bash
node esbuild.config.js
```

### 调试

1. 按 `F5` 打开新的 VSCode 窗口
2. 在新窗口中打开一个 Angular 项目
3. 右键点击 `angular.json` 文件测试插件功能

### 打包

```bash
npm install -g vsce
vsce package
```

## 技术栈

- **TypeScript**: 主要开发语言
- **VSCode Extension API**: 插件开发框架
- **esbuild**: 快速构建工具
- **Angular CLI**: 用于执行 schematics 命令

## 项目结构

```
src/
├── extension.ts              # 插件入口文件
├── providers/
│   └── angularSchematicsProvider.ts  # Angular Schematics 提供者
└── ui/
    └── schematicsQuickPick.ts        # UI 组件
```

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License

# Angular Schematics VSCode 插件使用说明

## 快速开始

### 1. 安装和构建

```bash
# 安装依赖
npm install

# 编译项目
npm run compile

# 或者使用 esbuild 构建
npm run build
```

### 2. 调试插件

1. 在 VSCode 中按 `F5` 启动调试
2. 这会打开一个新的 VSCode 窗口（扩展开发主机）
3. 在新窗口中打开一个 Angular 项目
4. 插件会自动检测 Angular 项目并显示状态栏指示器
5. 可以通过以下方式使用插件：
   - 点击状态栏的 "Angular Schematics" 按钮
   - 右键点击 `angular.json` 文件，选择 "Angular 原理图"
   - 使用命令面板（Ctrl+Shift+P）搜索 "Angular 原理图"

### 3. 使用方法

#### 方法一：状态栏按钮（推荐）
- 在 VSCode 状态栏右侧找到 "Angular Schematics" 按钮
- 点击按钮即可启动插件

#### 方法二：右键菜单
- 在文件资源管理器中右键点击任何文件或文件夹
- 选择 "Angular 原理图" 菜单项
- 在编辑器中右键点击也可以使用此功能

#### 方法三：命令面板
- 按 `Ctrl+Shift+P` 打开命令面板
- 输入 "Angular 原理图" 并选择

### 4. 功能流程

1. **项目检测**: 插件会自动检测当前项目是否为 Angular 项目
2. **菜单显示**: 在文件资源管理器和编辑器中显示右键菜单
3. **Schematics 选择**: 显示可用的 Angular 原理图列表
4. **名称输入**: 为要生成的文件输入名称
5. **选项配置**: 根据不同的 schematic 类型提供相应的配置选项
6. **文件生成**: 自动执行 `ng generate` 命令生成文件

### 5. 支持的 Schematics

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

### 6. 配置选项

#### Component 选项
- 是否创建测试文件
- 是否创建样式文件
- 是否创建扁平结构

#### Service 选项
- 是否创建测试文件

#### Module 选项
- 是否包含路由模块

#### Guard 选项
- 守卫类型选择（CanActivate, CanDeactivate 等）

### 7. 故障排除

#### 常见问题

1. **"请在Angular项目工作区中执行此命令"**
   - 确保当前工作区包含 `angular.json` 文件
   - 确保在 Angular 项目根目录下

2. **"未找到可用的schematics"**
   - 确保已安装 Angular CLI
   - 确保项目依赖已正确安装

3. **生成失败**
   - 检查 Angular CLI 版本
   - 查看控制台错误信息
   - 确保有足够的文件系统权限

### 8. 开发调试

#### 查看日志
- 打开 VSCode 开发者工具（帮助 > 切换开发人员工具）
- 查看控制台输出

#### 重新加载扩展
- 在扩展开发主机中按 `Ctrl+R` 重新加载窗口

### 9. 打包发布

```bash
# 安装 vsce
npm install -g vsce

# 打包扩展
vsce package

# 生成 .vsix 文件
```

### 10. 项目结构

```
src/
├── extension.ts              # 插件入口文件
├── providers/
│   └── angularSchematicsProvider.ts  # Angular Schematics 提供者
└── ui/
    └── schematicsQuickPick.ts        # UI 组件
```

## 技术栈

- **TypeScript**: 主要开发语言
- **VSCode Extension API**: 插件开发框架
- **esbuild**: 快速构建工具
- **Angular CLI**: 用于执行 schematics 命令

# Orange Memories

`Orange Memories` 是一个双人回忆空间项目，包含：

- 网页前端
- Express + MongoDB 后端
- Cloudinary 图片存储
- PWA 安装支持
- Capacitor 原生壳（Android / iOS）

当前主界面保留的核心模块是：

- 首页
- 纪事
- 相册
- 随笔
- 浮梦
- 游乐

## 技术栈

- 前端：`Vue 3` CDN、`Axios`、`Chart.js`
- 后端：`Express`、`Mongoose`
- 文件上传：`Multer`
- 图片存储：`Cloudinary`
- 移动端壳：`Capacitor`

## 目录说明

- [index.html](/Users/xuyingxin/Desktop/orange/index.html)：前端页面与交互逻辑
- [server.js](/Users/xuyingxin/Desktop/orange/server.js)：后端接口与静态资源服务
- [manifest.json](/Users/xuyingxin/Desktop/orange/manifest.json)：PWA 清单
- [sw.js](/Users/xuyingxin/Desktop/orange/sw.js)：Service Worker
- [mobile-config.js](/Users/xuyingxin/Desktop/orange/mobile-config.js)：原生壳 API 地址配置
- [capacitor.config.ts](/Users/xuyingxin/Desktop/orange/capacitor.config.ts)：Capacitor 配置
- [NATIVE_APP.md](/Users/xuyingxin/Desktop/orange/NATIVE_APP.md)：原生打包补充说明
- [android](/Users/xuyingxin/Desktop/orange/android)：Android 原生工程
- [ios](/Users/xuyingxin/Desktop/orange/ios)：iOS 原生工程

## 环境要求

- Node.js 18+
- MongoDB
- Cloudinary 账号

## 环境变量

项目使用 `.env`，至少需要：

```env
PORT=3000
MONGO_URI=your_mongodb_uri
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

## 安装依赖

```bash
npm install
```

## 本地启动

```bash
npm start
```

默认会启动在：

- [http://localhost:3000](http://localhost:3000)

## 数据与接口

后端默认同时提供：

- 静态站点访问
- 内容 CRUD：`/api/items`
- 相册追加图片：`/api/items/:id/images`
- 相册删除图片：`/api/items/:id/images/:imageId`
- 关系与问答相关接口
- 媒体代理接口

数据主要落在 MongoDB，图片落在 Cloudinary。

## PWA

项目已经支持以网页应用方式安装：

- iPhone：Safari -> `添加到主屏幕`
- Android：Chrome -> `安装应用`

PWA 图标资源位于：

- [icons](/Users/xuyingxin/Desktop/orange/icons)

## 原生 App

项目已经接入 `Capacitor`。

### 先配置 API 地址

原生壳里的网页不会和 `server.js` 同源，所以先改：

- [mobile-config.js](/Users/xuyingxin/Desktop/orange/mobile-config.js)

例如：

```js
window.__ORANGE_APP_CONFIG__ = {
  apiBase: "https://your-domain.com"
};
```

### 准备与同步

```bash
npm run mobile:prepare
npm run mobile:sync
```

### Android

打开 Android Studio：

```bash
npm run mobile:open:android
```

一键构建 release APK：

```bash
npm run mobile:build:android:release
```

当前已生成的包：

- 调试包：[app-debug.apk](/Users/xuyingxin/Desktop/orange/android/app/build/outputs/apk/debug/app-debug.apk)
- 已签名测试包：[app-release-signed.apk](/Users/xuyingxin/Desktop/orange/android/app/build/outputs/apk/release/app-release-signed.apk)

说明：

- 当前 `release` 已改为固定的本地 release keystore 签名
- 适合长期测试分发和发给别人直接安装
- 只要继续使用同一套 keystore，后续新版本可以直接覆盖安装
- 仍然不等于已满足应用商店上架要求

构建脚本会优先读取项目根目录下的 [`.android-signing.env`](/Users/xuyingxin/Desktop/orange/.android-signing.env)。

如果要改成你自己的正式签名，可用环境变量覆盖：

```bash
ANDROID_KEYSTORE_PATH=/path/to/your.keystore
ANDROID_KEYSTORE_ALIAS=your_alias
ANDROID_KEYSTORE_PASSWORD=your_password
ANDROID_KEY_PASSWORD=your_password
npm run mobile:build:android:release
```

### iOS

打开 Xcode：

```bash
npm run mobile:open:ios
```

iOS workspace：

- [App.xcworkspace](/Users/xuyingxin/Desktop/orange/ios/App/App.xcworkspace)

注意：

- 当前只按免费 Apple 账号方案支持“装到你自己的 iPhone 上测试”
- 不面向别人分发，也不保证可直接导出对外安装的 `IPA`
- 需要 Apple 签名身份才能真机安装
- 如果 `security find-identity -v -p codesigning` 仍然是 `0 valid identities found`，说明系统里还没有可用签名身份
- 如果 `xcrun simctl list runtimes` 没有 iOS runtime，说明 Xcode Simulator 组件没有正确安装

更完整的原生排错说明见：

- [NATIVE_APP.md](/Users/xuyingxin/Desktop/orange/NATIVE_APP.md)

## 常用脚本

- `npm start`：启动后端与静态站点
- `npm run mobile:prepare`：准备移动端网页资源
- `npm run mobile:sync`：同步到原生工程
- `npm run mobile:add:android`：生成 Android 工程
- `npm run mobile:add:ios`：生成 iOS 工程
- `npm run mobile:open:android`：用 Android Studio 打开 Android 工程
- `npm run mobile:open:ios`：用 Xcode 打开 iOS 工程
- `npm run mobile:build:android:release`：构建并签名 Android release APK

## 已知限制

- 前端主体仍然是单文件 [index.html](/Users/xuyingxin/Desktop/orange/index.html)，后续维护成本较高
- 登录不是完整的后端鉴权体系
- iOS 构建强依赖本机 Xcode 组件与签名状态
- Android 当前输出的是测试签名包，不是商店发布包

## 适合继续优化的方向

- 拆分前端单文件结构
- 增加正式鉴权
- 增加自动化测试
- 增加正式的 Android / iOS 发布签名流程

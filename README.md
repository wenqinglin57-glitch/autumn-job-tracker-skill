# 秋招求职工作台 Skill

一个用于创建、维护和排查「秋招求职工作台」Microsoft Edge 扩展的 Codex Skill。

该项目包含完整的 Edge 扩展模板、产品规则、隐私约束以及验证和打包脚本。它可以帮助 Codex 持续维护岗位记录、申请进度、招聘邮件、登录状态、测试与面试截止时间等功能，同时避免覆盖用户手动填写的信息。

> 注意：Codex Skill 是开发和维护工作流，真正运行在浏览器中的程序位于 `assets/autumn-job-tracker/`。

## 主要功能

### 岗位管理

- 记录岗位名称、企业名字、工作地点和投递日期；
- 保存当前进度、下一步测试或面试及截止时间；
- 查询网址始终取自浏览器地址栏；
- 企业名字只能由用户手动填写；
- 刷新时不会覆盖企业名字、岗位名称、工作地点和投递日期；
- 自动识别同一网站中的多条申请；
- 防止同一岗位被重复添加；
- 未通过的岗位自动放入“已归档”，并且只提醒一次。

### 登录状态检查

以下任意内容可作为招聘页面正常读取的依据：

- `应聘记录`
- `投递记录`
- `应聘进展`
- `岗位名称`
- `职位名称`
- `应聘职位`
- 包含“投递简历”或“已投递”以及日期的岗位卡片
- 用户已经保存的岗位名称

如果页面只出现“登录”，状态显示为“未检查”，不会直接判定登录失败。

如果出现验证码、登录过期或明确的重新登录页面，工作台才会提示需要处理。

### 招聘邮件管理

- 使用已经登录的网页版邮箱；
- 支持 QQ、163、126、Gmail 和 Outlook 等常见邮箱；
- 只搜索收件箱；
- 使用手动填写的企业名字进行全文搜索；
- 每个企业在一次刷新中只提交一次搜索；
- 不使用 AI 搜索、联系人搜索或其他搜索入口；
- 搜索到邮件后打开邮件详情页再提取信息；
- 保存邮件标题、发件人、正文摘要、时间和详情链接；
- 已收录、待确认、已取消或已删除的邮件不会重复收录；
- 无法唯一匹配的邮件进入“待确认邮件”；
- 支持单封删除、多选删除和批量删除。

### 定时检查和提醒

- 支持设置 1–5 个每日检查时间；
- 可以随时点击“立即刷新进度”；
- 新进度会弹出系统通知；
- 未读动态显示在扩展图标和工作台中；
- 进入下一阶段时显示祝贺提示；
- 未通过时显示归档提醒；
- 登录失效时提醒用户重新登录。

### 手动抓取规则

单独打开或刷新招聘网站、邮箱网站时，扩展保持静默：

- 不自动抓取岗位；
- 不自动登记邮箱；
- 不自动保存邮件；
- 不监听页面变化进行被动抓取。

只有用户点击扩展图标，或者工作台明确执行“立即刷新”或定时检查时，才会读取相关页面。

## 隐私说明

该项目采用本地存储设计：

- 不读取或上传浏览器密码；
- 不导出 Cookie；
- 不读取或保存短信验证码；
- 不上传浏览器会话令牌；
- 不接入第三方分析服务；
- 岗位、邮箱和个人资料保存在当前 Edge 扩展的本地存储中。

请不要把包含真实邮箱、手机号、招聘记录、Cookie、令牌或浏览器配置的数据提交到 GitHub。

当前版本没有实现端到端加密云同步，因此不同设备之间不会自动同步数据。

## 目录结构

```text
autumn-job-tracker-skill/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── references/
│   └── product-rules.md
├── scripts/
│   ├── verify-extension.ps1
│   └── package-extension.ps1
└── assets/
    └── autumn-job-tracker/
        ├── manifest.json
        ├── background.js
        ├── content.js
        ├── extractor.js
        ├── popup.html
        ├── popup.js
        ├── index.html
        ├── app.js
        ├── styles.css
        └── assets/
```

- `SKILL.md`：Codex Skill 的主要工作流程；
- `agents/openai.yaml`：Skill 的显示名称、图标和默认提示词；
- `references/product-rules.md`：岗位、登录、邮箱、去重和隐私规则；
- `scripts/verify-extension.ps1`：检查扩展结构和手动抓取规则；
- `scripts/package-extension.ps1`：验证并打包 Edge 扩展；
- `assets/autumn-job-tracker/`：可直接加载到 Edge 的扩展模板。

## 安装 Codex Skill

### 方法一：使用 Git 克隆

在 Windows PowerShell 中运行：

```powershell
git clone https://github.com/wenqinglin57-glitch/autumn-job-tracker-skill.git "$env:USERPROFILE\.codex\skills\autumn-job-tracker"
```

重新打开 Codex 后，即可使用：

```text
$autumn-job-tracker
```

### 方法二：手动安装

1. 下载本仓库；
2. 解压文件；
3. 把整个文件夹复制到：

```text
C:\Users\你的用户名\.codex\skills\autumn-job-tracker
```

4. 确保 `SKILL.md` 位于该文件夹根目录；
5. 重新打开 Codex。

## 使用示例

安装后可以向 Codex 提出以下请求：

```text
使用 $autumn-job-tracker 帮我创建秋招求职工作台 Edge 扩展。
```

```text
使用 $autumn-job-tracker 修复立即刷新覆盖企业名字的问题。
```

```text
使用 $autumn-job-tracker 调整招聘邮箱搜索和邮件去重逻辑。
```

```text
使用 $autumn-job-tracker 检查打开网页时是否会自动抓取。
```

```text
使用 $autumn-job-tracker 验证扩展并打包成 ZIP。
```

## 安装 Edge 扩展

1. 打开 Microsoft Edge；
2. 在地址栏输入：

```text
edge://extensions
```

3. 打开“开发人员模式”；
4. 点击“加载解压缩的扩展”；
5. 选择：

```text
assets/autumn-job-tracker
```

6. 将“求职工作台”固定到浏览器工具栏。

修改扩展代码后，需要返回 `edge://extensions`，在扩展卡片上点击“重新加载”。

## 验证扩展

在仓库根目录运行：

```powershell
.\scripts\verify-extension.ps1
```

该脚本会检查：

- Manifest V3 配置；
- 必需的扩展文件；
- 工具栏弹窗配置；
- 页面打开时不存在被动抓取监听；
- 点击扩展后的明确抓取入口。

## 打包扩展

运行：

```powershell
.\scripts\package-extension.ps1
```

验证通过后会生成：

```text
autumn-job-tracker-edge-extension.zip
```

也可以指定扩展目录和输出位置：

```powershell
.\scripts\package-extension.ps1 `
  -ExtensionPath "C:\path\to\autumn-job-tracker" `
  -OutputPath "C:\path\to\autumn-job-tracker.zip"
```

## 开发约束

修改扩展时应持续满足以下规则：

1. 企业名字只能手动填写；
2. 刷新不能覆盖岗位身份字段；
3. 打开网页不能自动抓取；
4. 网页标题不能被识别为企业名字；
5. Offer 流程图中的普通阶段文字不能被误判为已收到 Offer；
6. 登录状态必须结合岗位页面证据判断；
7. 邮件必须打开详情页后再收录；
8. 同一岗位和同一邮件不能重复保存；
9. 未通过状态只能提醒一次；
10. 不得上传 Cookie、密码、验证码或个人招聘数据。

## 当前版本

扩展模板版本：`0.31.0`

当前模板适合本地 Edge 浏览器使用。邮箱和招聘网站的页面结构可能发生变化，遇到识别失败时，可以继续通过 `$autumn-job-tracker` 更新提取规则和测试。

实例：
<img width="1910" height="873" alt="338d67e7-289b-4ff5-8c20-e1ab1f3cb560" src="https://github.com/user-attachments/assets/6d9efb04-533c-453e-9675-6419575b09a9" />

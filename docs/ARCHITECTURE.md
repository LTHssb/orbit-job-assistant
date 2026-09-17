# ORBIT 系统架构

## 1. 分层设计

```text
页面层       app/**/page.tsx, components/**
接口层       app/api/**/route.ts
领域层       lib/job-schema.ts, lib/source-import.ts
任务层       lib/sources/task-runner.ts
数据层       lib/supabase/*-repository.ts
基础设施     Supabase · DeepSeek · Vercel Functions · Vercel Cron
```

页面层只负责交互和状态呈现；岗位、来源、简历和采集运行记录通过接口层访问。数据访问集中在 repository，避免把 Supabase 查询散落在组件中。

## 2. 岗位采集链路

```text
Vercel Cron
  -> /api/cron/sources（枚举 active 来源）
  -> /api/cron/source?sourceId=...
  -> 创建 collection_runs
  -> 选择静态 fetch 或 Chromium 动态渲染
  -> 站点适配器提取岗位字段
  -> 统一 JobRecord 校验与去重
  -> 写入 jobs / collection_runs
  -> 前端筛选与详情展示
```

每个来源都有独立运行记录，因此单个网站失败不会阻断其他公司。动态站点通过单独的函数入口和 Chromium tracing 配置打包，避免把浏览器依赖塞进普通页面函数。

## 3. 统一岗位模型

岗位至少归一化为：

- `company`：公司
- `title`：职位名称
- `city` / `workMode`：工作地点与工作方式
- `experience` / `education`：经验和学历要求
- `salary`：薪资信息（官网未提供时保持空值，不猜测）
- `description` / `requirements`：职责与任职要求
- `sourceUrl`：官网职位链接
- `publishedAt` / `capturedAt`：发布时间与抓取时间

缺失字段允许为空；原始官网链接始终保留，用于用户回查和人工确认。

## 4. AI 能力边界

DeepSeek 只处理已经上传或提交给服务端的文本内容，不直接替代官网采集器。简历解析和 JD 结构化分别走独立接口，输出先做 JSON 校验，再写入用户数据。

- 浏览器端不读取 AI Key。
- AI 调用失败时保留原文件/原文和失败状态，允许重试。
- AI 结果展示“解析状态”和“更新时间”，避免把模型推断包装成官网事实。

## 5. 可靠性与安全

- Cron 接口使用 `CRON_SECRET` 保护。
- 服务端使用 Supabase Secret Key，客户端仅使用 Publishable Key。
- 用户数据通过 Supabase Auth 与 RLS 隔离。
- 采集任务写入开始、结束、成功数、失败原因，便于运营排查。
- Git 忽略所有本地环境文件、凭证、构建产物和个人文档。

## 6. 扩展方式

新增公司时优先新增来源适配器，而不是修改岗位页面：

1. 识别官网是静态 HTML、公开 JSON 还是需要浏览器渲染。
2. 在 `source-adapters.ts` 中实现抓取和字段映射。
3. 使用统一 schema 校验与去重。
4. 增加一条来源配置和一组样例响应。
5. 观察 collection run 后再开放给用户。

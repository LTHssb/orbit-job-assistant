export type SourceAdapterKey =
  | "baidu-official"
  | "bytedance-official"
  | "tencent-official"
  | "alibaba-official"
  | "meituan-official"
  | "huawei-official"
  | "jd-official"
  | "xiaomi-official"
  | "netease-official"
  | "pinduoduo-official"
  | "generic-public";

export type SourceAdapterInfo = {
  key: SourceAdapterKey;
  company: string;
  hosts: string[];
  status: "ready" | "experimental" | "planned";
  note: string;
};

/**
 * Adapter registry is deliberately data-driven. A site is not treated as
 * "supported" merely because its page can be downloaded: ready means that
 * the site has a tested, site-specific contract. The generic adapter remains
 * available for public JSON/JSON-LD/RSS pages and clearly reports its limits.
 */
export const SOURCE_ADAPTERS: SourceAdapterInfo[] = [
  { key: "baidu-official", company: "百度", hosts: ["talent.baidu.com"], status: "ready", note: "百度官方列表/详情接口，支持分页" },
  { key: "bytedance-official", company: "字节跳动", hosts: ["jobs.bytedance.com"], status: "experimental", note: "官网列表依赖动态脚本/会话，已登记浏览器采集探针，暂不伪装成静态接口已完成" },
  { key: "tencent-official", company: "腾讯", hosts: ["join.qq.com"], status: "experimental", note: "官网列表依赖动态脚本/会话，旧公开接口已失效，等待浏览器采集 Worker" },
  { key: "alibaba-official", company: "阿里巴巴", hosts: ["talent.alibaba.com", "campus-talent.alibaba.com"], status: "ready", note: "阿里官方 /position/search 接口，含 CSRF 会话和分页" },
  { key: "meituan-official", company: "美团", hosts: ["zhaopin.meituan.com"], status: "ready", note: "美团官方 /api/official/job/getJobList 接口，支持分页和职位详情链接" },
  { key: "huawei-official", company: "华为", hosts: ["career.huawei.com"], status: "planned", note: "已登记站点，待锁定官方职位接口" },
  { key: "jd-official", company: "京东", hosts: ["campus.jd.com"], status: "planned", note: "已登记站点，待锁定官方职位接口" },
  { key: "xiaomi-official", company: "小米", hosts: ["hr.xiaomi.com"], status: "planned", note: "已登记站点，待锁定官方职位接口" },
  { key: "netease-official", company: "网易", hosts: ["campus.163.com"], status: "planned", note: "已登记站点，待锁定官方职位接口" },
  { key: "pinduoduo-official", company: "拼多多", hosts: ["campus.pinduoduo.com"], status: "planned", note: "已登记站点，待锁定官方职位接口" },
];

const hostMatches = (hostname: string, host: string) => hostname === host || hostname.endsWith(`.${host}`);

export function getSourceAdapter(url: URL): SourceAdapterInfo {
  return SOURCE_ADAPTERS.find((adapter) => adapter.hosts.some((host) => hostMatches(url.hostname, host))) ?? {
    key: "generic-public",
    company: "自定义来源",
    hosts: [],
    status: "ready",
    note: "先解析公开 JSON、JSON-LD、RSS/Atom 和静态 HTML，失败后自动尝试通用浏览器渲染",
  };
}

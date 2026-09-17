"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

type GalaxyMapProps = {
  jobCount: number;
  companyCount: number;
  sourceCount: number;
};

const stages = [
  {
    month: "06 — 07",
    title: "准备期",
    description: "让经历更接近目标岗位",
    tone: "violet",
    modules: [
      { icon: "▣", title: "简历工作台", note: "多版本简历一岗一改", href: "/resumes", size: "planet-medium", status: "READY" },
    ],
  },
  {
    month: "08",
    title: "投递期",
    description: "捕获机会，建立自己的岗位池",
    tone: "mint",
    current: true,
    modules: [
      { icon: "◎", title: "来源管理", note: "官网入口持续观测", href: "/sources", size: "planet-large", status: "LIVE" },
      { icon: "✦", title: "岗位聚合", note: "筛选值得打开的新岗位", href: "/jobs", size: "planet-xl", status: "LIVE" },
      { icon: "↗", title: "投递追踪", note: "让每次行动都有下一步", href: "/applications", size: "planet-medium", status: "LIVE" },
    ],
  },
  {
    month: "09",
    title: "笔面期",
    description: "把面试节点放在今天之前",
    tone: "blue",
    modules: [
      { icon: "◷", title: "求职日历", note: "面试、笔试、跟进一屏掌握", href: "/calendar", size: "planet-medium", status: "NEXT" },
    ],
  },
  {
    month: "10 — 11",
    title: "Offer 期",
    description: "复盘选择，驶向下一站",
    tone: "orange",
    modules: [],
  },
];

const modules = stages.flatMap((stage) => stage.modules.map((module) => ({ ...module, stage: stage.title })));

export function GalaxyMap({ jobCount, companyCount, sourceCount }: GalaxyMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const map = mapRef.current;
    if (!canvas || !map) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let animationFrame = 0;
    let stars: Array<{ x: number; y: number; radius: number; alpha: number; speed: number; drift: number; color: string; streak: boolean }> = [];

    const resize = () => {
      const bounds = map.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, bounds.width * ratio);
      canvas.height = Math.max(1, bounds.height * ratio);
      canvas.style.width = `${bounds.width}px`;
      canvas.style.height = `${bounds.height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.max(80, Math.min(240, Math.round((bounds.width * bounds.height) / 8600)));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * bounds.width,
        y: Math.random() * bounds.height,
        radius: Math.random() * 1.15 + 0.2,
        alpha: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.024 + 0.008,
        drift: Math.random() * 0.16 + 0.035,
        color: Math.random() > 0.76 ? "#b6edcf" : Math.random() > 0.52 ? "#d1c7ff" : "#ffffff",
        streak: Math.random() > 0.86,
      }));
    };

    const render = () => {
      const bounds = map.getBoundingClientRect();
      context.clearRect(0, 0, bounds.width, bounds.height);
      for (const star of stars) {
        star.alpha += star.speed;
        star.x += star.drift;
        star.y += star.drift * 0.18;
        if (star.x > bounds.width + 12 || star.y > bounds.height + 12) {
          star.x = -8;
          star.y = Math.random() * bounds.height * 0.88;
        }
        context.globalAlpha = 0.18 + (Math.sin(star.alpha) + 1) * 0.34;
        context.fillStyle = star.color;
        context.beginPath();
        context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        context.fill();
        if (star.streak) {
          context.globalAlpha *= 0.28;
          context.strokeStyle = star.color;
          context.lineWidth = star.radius;
          context.beginPath();
          context.moveTo(star.x - star.drift * 7, star.y - star.drift * 1.2);
          context.lineTo(star.x, star.y);
          context.stroke();
        }
      }
      context.globalAlpha = 1;
      animationFrame = window.requestAnimationFrame(render);
    };

    resize();
    render();
    window.addEventListener("resize", resize);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <main className="galaxy-map" ref={mapRef} aria-labelledby="galaxy-title">
      <canvas className="galaxy-stars" ref={canvasRef} aria-hidden="true" />
      <div className="galaxy-nebula galaxy-nebula-left" aria-hidden="true" />
      <div className="galaxy-nebula galaxy-nebula-right" aria-hidden="true" />
      <div className="galaxy-grid" aria-hidden="true" />
      <div className="galaxy-inner">
        <header className="galaxy-header">
          <div>
            <p className="galaxy-kicker">ORBIT · CAREER CONSTELLATION</p>
            <h1 id="galaxy-title">2026 秋招全流程 · 求职中枢</h1>
            <p className="galaxy-subtitle">把准备、发现、投递和面试，放进同一片可探索的银河。悬停星球查看状态，点击后进入对应工作区。</p>
          </div>
          <div className="galaxy-actions">
            <Link className="galaxy-board-link" href="/workspace">进入求职中枢 <span>↗</span></Link>
            <div className="galaxy-demo-note"><i /> 演示账户 · 航线已就绪</div>
          </div>
        </header>

        <div className="galaxy-stats" aria-label="求职数据概览">
          <div><strong>{jobCount || "—"}</strong><span>岗位线索</span></div>
          <div><strong>{companyCount || "—"}</strong><span>目标公司</span></div>
          <div><strong>{sourceCount || "—"}</strong><span>观测来源</span></div>
          <div><strong>03</strong><span>进行中行动</span></div>
        </div>

        <div className="galaxy-module-row" aria-label="当前可用工作区">
          {modules.map((module) => <Planet key={module.title} module={module} tone={module.stage === "投递期" ? "mint" : "violet"} />)}
        </div>

        <div className="galaxy-axis" aria-label="秋招阶段导航">
          <div className="galaxy-track-glow" aria-hidden="true" />
          <div className="galaxy-track" aria-hidden="true"><span /><span /><span /><span /></div>
          {stages.map((stage) => (
            <div className={`galaxy-stage ${stage.current ? "is-current" : ""}`} key={stage.title}>
              <div className="galaxy-node-line" aria-hidden="true" />
              <div className="galaxy-node-wrap">
                <span className="galaxy-node" />
                <div><strong>{stage.month} · {stage.title}</strong><small>{stage.description}</small></div>
              </div>
              <div className="galaxy-node-line galaxy-node-line-down" aria-hidden="true" />
            </div>
          ))}
          <span className="galaxy-endpoint" aria-hidden="true">✦</span>
        </div>

        <footer className="galaxy-footer">
          <span><b className="legend-dot legend-live" />实时工作区</span>
          <span><b className="legend-dot legend-next" />下一步行动</span>
          <span><b className="legend-dot legend-later" />后续探索</span>
          <span className="galaxy-footer-tip">星场正在流动 · 点击任意可交互星球进入工作台</span>
        </footer>
      </div>
    </main>
  );
}

function Planet({ module, tone }: { module: (typeof modules)[number]; tone: string }) {
  return (
    <Link className={`galaxy-planet ${module.size} galaxy-planet-${tone}`} href={module.href}>
      <span className="planet-status">{module.status}</span>
      <span className="planet-orb">{module.icon}</span>
      <span className="planet-copy"><small className="planet-stage">{module.stage}</small><strong>{module.title}</strong><small>{module.note}</small></span>
    </Link>
  );
}

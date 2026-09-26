/**
 * dsh-minesweeper — 样式。
 *
 * 主题策略（v0.3 起）：
 * - 语义色（数字/状态/品牌）一律走 `--dsw-alias-*` / `--dsw-state-*` token，禁 6 位 hex（构建门禁会扫）。
 * - 明暗层级例外项：DSH 的 `--dsw-shadow-*`/`--dsw-alias-border-*` token 在**浅色**主题下
 *   透明度仅 0.05–0.12（白底上几乎不可见），纯 token 无法表达"凸起/凹陷"。
 *   因此明暗层级用**主题无关的中性 rgba 光影**（纯亮度通道，不携带主题色）：
 *     浅色主题靠"暗影"表达立体感，深色主题靠"顶部高亮"表达，两种主题各自成立。
 * - 已开空白格（不可点击）用 `--msw-floor` 明暗 tint：浅色加暗、深色加亮，
 *   与"未开格凸起"形成明确的"地板 vs 按键"分界。
 */
export const CSS_TEXT = `
.msw-root{
  --msw-floor: rgba(0,0,0,0.055);
  --msw-cell-gap: 2px;
  display:flex; flex-direction:column; gap:10px;
  padding:12px; width:100%;
  font-family:inherit;
  color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-1);
  box-sizing:border-box;
}
body[data-ds-dark-theme] .msw-root{ --msw-floor: rgba(255,255,255,0.06); }

.msw-hud{
  display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  padding:8px 10px;
  border:0.5px solid var(--dsw-alias-border-l2);
  border-radius:10px;
  background:var(--dsw-alias-bg-layer-2);
}
.msw-face{
  width:38px; height:38px; flex:0 0 auto;
  display:flex; align-items:center; justify-content:center;
  font-size:20px; line-height:1;
  border:0.5px solid var(--dsw-alias-border-l2);
  border-radius:8px;
  background:var(--dsw-alias-interactive-bg-hover);
  cursor:pointer;
}
.msw-face:active{ transform:scale(0.94); }
.msw-meters{ display:flex; gap:8px; align-items:stretch; flex:1; }
.msw-meter{
  min-width:64px; padding:3px 8px 4px; text-align:center;
  border:0.5px solid var(--dsw-alias-border-l3);
  border-radius:6px;
  background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary);
  box-shadow:0 1px 2px rgba(0,0,0,0.18);
}
.msw-meter-cap{
  display:block; font-size:10px; line-height:14px; letter-spacing:0;
  color:var(--dsw-alias-label-tertiary);
  font-family:inherit;
}
.msw-meter-val{
  display:block;
  font-variant-numeric:tabular-nums;
  font-size:15px; font-weight:600;
  font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing:1px;
}
.msw-row{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.msw-select,.msw-input{
  font:inherit; font-size:12px;
  color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-3);
  border:0.5px solid var(--dsw-alias-border-l2);
  border-radius:7px; padding:4px 8px;
}
.msw-input{ width:52px; text-align:center; }
.msw-btn{
  font:inherit; font-size:12px;
  padding:4px 12px; border-radius:7px; cursor:pointer;
  border:0.5px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-label-primary);
}
.msw-btn:active{ background:var(--dsw-alias-interactive-bg-active); }
.msw-btn-primary{
  background:var(--dsw-alias-button-primary-fill);
  color:var(--dsw-alias-label-primary-foreground);
  border-color:transparent;
}
.msw-btn.msw-flagmode-on,
.msw-btn.msw-fs-on{
  background:var(--dsw-alias-button-primary-fill);
  color:var(--dsw-alias-label-primary-foreground);
  border-color:transparent;
}
.msw-err{ font-size:12px; color:var(--dsw-alias-state-error-primary); }
.msw-err:empty{ display:none; }
.msw-hint{ font-size:11px; line-height:1.5; color:var(--dsw-alias-label-tertiary); }
.msw-board-wrap{ overflow-x:auto; border:0.5px solid var(--dsw-alias-border-l2); border-radius:10px; padding:6px; background:var(--dsw-alias-bg-layer-2); }
.msw-board-wrap.msw-flagmode{ box-shadow: inset 0 0 0 1.5px var(--dsw-alias-brand-primary); }
.msw-board{
  display:grid; gap:var(--msw-cell-gap);
  /* grid-template-columns 由 JS 按列数注入（repeat(cols, minmax(0,1fr))） */
}
/* ---- 棋盘格：三态 = 未开(可点,凸起) / 已开空白(不可点,凹陷地板) / 已开数字(可点,和弦) ---- */
.msw-cell{
  position:relative; aspect-ratio:1/1; min-width:0;
  display:flex; align-items:center; justify-content:center;
  font-size:11px; font-weight:700; user-select:none; -webkit-user-select:none;
  border-radius:4px; cursor:default;
  border:none; padding:0;
  touch-action:manipulation;
}
/* 未开格 = 可点击：凸起（暗底靠投影+底缘暗缘；深底靠顶部高亮） */
.msw-cell:not(.msw-open){
  cursor:pointer;
  background:var(--dsw-alias-bg-layer-3);
  box-shadow:
    0 1.5px 3px rgba(0,0,0,0.30),
    inset 0 1.5px 0 rgba(255,255,255,0.55),
    inset 0 -1.5px 0 rgba(0,0,0,0.30);
}
.msw-cell:not(.msw-open):hover{
  background:var(--dsw-alias-bg-layer-2);
  box-shadow:
    0 2px 5px rgba(0,0,0,0.35),
    inset 0 2px 0 rgba(255,255,255,0.65),
    inset 0 -2px 0 rgba(0,0,0,0.35),
    inset 0 0 0 1px var(--dsw-alias-brand-primary);
}
/* 已开空白格 = 不可点击：凹陷地板（tint + 顶部内阴影 + 描边） */
.msw-cell.msw-open{
  background:linear-gradient(var(--msw-floor),var(--msw-floor)),var(--dsw-alias-bg-layer-1);
  box-shadow:
    inset 0 2px 3px rgba(0,0,0,0.28),
    inset 0 -1px 0 rgba(255,255,255,0.10),
    inset 0 0 0 1px rgba(0,0,0,0.10);
}
/* 已开数字格 = 可点击（和弦）：微凸 + 悬停品牌色描边 */
.msw-cell.msw-open[class*="msw-n"]{
  cursor:pointer;
  box-shadow:
    inset 0 1.5px 0 rgba(255,255,255,0.50),
    inset 0 -1.5px 0 rgba(0,0,0,0.25),
    inset 0 0 0 1px rgba(0,0,0,0.10);
}
.msw-cell.msw-open[class*="msw-n"]:hover{
  box-shadow:
    inset 0 0 0 1.5px var(--dsw-alias-brand-primary),
    inset 0 1.5px 0 rgba(255,255,255,0.50),
    inset 0 -1.5px 0 rgba(0,0,0,0.25);
}
.msw-cell.msw-flag::after{ content:"\\2691"; font-size:12px; color:var(--dsw-alias-state-error-primary); }
.msw-cell.msw-boom{ background:var(--dsw-alias-state-error-secondary); }
.msw-cell.msw-wrongflag::before{ content:"\\2717"; position:absolute; font-size:13px; color:var(--dsw-alias-state-error-primary); }
.msw-n1{ color:var(--dsw-alias-brand-primary); }
.msw-n2{ color:var(--dsw-alias-state-success-primary); }
.msw-n3{ color:var(--dsw-alias-state-error-primary); }
.msw-n4{ color:var(--dsw-alias-state-business-primary); }
.msw-n5{ color:var(--dsw-alias-state-warn-primary); }
.msw-n6{ color:var(--dsw-alias-link); }
.msw-n7{ color:var(--dsw-alias-label-primary); }
.msw-n8{ color:var(--dsw-alias-state-warn-secondary); }
.msw-stats{ display:flex; align-items:center; gap:14px; flex-wrap:wrap; font-size:12px; color:var(--dsw-alias-label-secondary); }
.msw-stats b{ color:var(--dsw-alias-label-primary); font-weight:600; }
.msw-link-btn{
  font:inherit; font-size:12px; cursor:pointer;
  border:none; background:none; padding:0;
  color:var(--dsw-alias-link); text-decoration:underline;
}
.msw-title{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
.msw-title h1{ font-size:14px; font-weight:600; margin:0; color:var(--dsw-alias-label-primary); }
.msw-badge{ font-size:11px; color:var(--dsw-alias-label-tertiary); }

/* ---- 全屏模式（v0.3）：root 覆盖整个窗口，棋盘按 cols/rows 比例放大且不超视口 ----
   --msw-ar = cols/rows（JS 注入到 .msw-root，供 wrap 读取；勿用 fit-content+百分比子宽，
   会形成循环尺寸导致棋盘塌缩）。 */
.msw-root.msw-fs{
  position:fixed; inset:0; z-index:2147483000;
  padding:14px 16px; overflow:auto;
  background:var(--dsw-alias-bg-base);
}
.msw-root.msw-fs .msw-board-wrap{
  width:min(100%, calc((100dvh - 250px) * var(--msw-ar, 1)));
  margin-inline:auto;
}
.msw-root.msw-fs .msw-board{
  width:100%;
  margin-inline:auto;
}

/* ---- 插件页配置区卡片（v0.6，plugins.bundle.config；独立于 .msw-root 上下文） ---- */
.msw-card{
  display:flex; flex-direction:column; gap:8px;
  padding:12px 14px;
  border:0.5px solid var(--dsw-alias-border-l2);
  border-radius:10px;
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary);
  font-size:13px;
}
.msw-card-title{ font-size:13px; font-weight:600; }
.msw-card-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
.msw-card-label{ color:var(--dsw-alias-label-primary); }
.msw-card-note{ font-size:11px; line-height:1.5; color:var(--dsw-alias-label-tertiary); }
.msw-switch{ position:relative; display:inline-flex; cursor:pointer; }
.msw-switch input{ position:absolute; opacity:0; width:0; height:0; }
.msw-switch-track{
  width:34px; height:18px; border-radius:999px;
  background:var(--dsw-alias-bg-layer-3);
  border:0.5px solid var(--dsw-alias-border-l2);
  position:relative; transition:background .15s ease;
}
.msw-switch-track::after{
  content:""; position:absolute; top:50%; left:2px;
  width:12px; height:12px; border-radius:50%;
  background:var(--dsw-alias-label-secondary);
  transform:translateY(-50%); transition:left .15s ease, background .15s ease;
}
.msw-switch input:checked + .msw-switch-track{
  background:var(--dsw-alias-brand-primary);
  border-color:var(--dsw-alias-brand-primary);
}
.msw-switch input:checked + .msw-switch-track::after{
  left:calc(100% - 14px);
  background:var(--dsw-alias-bg-base);
}
`;
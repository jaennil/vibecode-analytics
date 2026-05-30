const state = {
  rawPoints: [],
  rawPrompts: [],
  points: [],
  prompts: [],
  data: null,
  source: "all",
  project: "all",
  range: "24h",
  projectSearch: "",
  projectPage: 0,
  modalProject: null,
  dailyChart: null,
  dailySignature: "",
  projectCharts: [],
  chartProjectKeys: [],
  chartDataSignatures: [],
  modalChart: null,
  modalDataSignature: "",
  modalWindow: "all",
  modalSumVisible: false,
  loading: false,
};

const $ = (id) => document.getElementById(id);

const formatNumber = (value) => {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-US");
};

const timeLabel = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const newLoad = (p) =>
  Number(p?.input || 0) + Number(p?.cacheCreate || 0) + Number(p?.output || 0) + Number(p?.reasoning || 0);

const projectKey = (p) => `${p?.source || "unknown"}:${p?.projectPath || p?.project || "unknown"}`;

const dayKey = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const nicePath = (value) => {
  if (!value) return "";
  if (value.length <= 74) return value;
  return `...${value.slice(-71)}`;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const shortText = (value, limit = 120) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
};

const colors = {
  grid: "#314047",
  text: "#d7e0e4",
  muted: "#94a3aa",
  fresh: "#5dd2a4",
  cache: "#67a8ff",
  output: "#f3c969",
  reasoning: "#db79ff",
  prompt: "#e7f08b",
  codex: "#7cc8ff",
  claude: "#ffb86c",
  hot: "#ff6b6b",
  ok: "#6de28c",
};

function exactNumber(value) {
  return Math.round(Number(value || 0)).toLocaleString("en-US");
}

function tooltipRow(label, value, muted = false) {
  return `<div class="chart-tooltip-row${muted ? " muted" : ""}"><span>${label}</span><strong>${exactNumber(value)}</strong></div>`;
}

function tokenTooltip(params) {
  const promptItem = params.find((param) => param.data?.prompt);
  if (promptItem) {
    const prompt = promptItem.data.prompt;
    return `
      <div class="chart-tooltip">
        <div class="chart-tooltip-time">${escapeHtml(timeLabel(prompt.timestamp))}</div>
        <div class="chart-tooltip-title">User prompt</div>
        ${tooltipRow("Images", prompt.imageCount || 0)}
        <div class="chart-tooltip-rule"></div>
        <div class="chart-tooltip-text">${escapeHtml(shortText(prompt.text, 220))}</div>
      </div>
    `;
  }

  const item = params.find((param) => param.data?.event) || params[0];
  const point = item?.data?.event;
  if (!point) return "";

  return `
    <div class="chart-tooltip">
      <div class="chart-tooltip-time">${escapeHtml(timeLabel(point.timestamp))}</div>
      ${tooltipRow("New tokens", newLoad(point))}
      <div class="chart-tooltip-rule"></div>
      ${tooltipRow("Fresh input", point.input)}
      ${tooltipRow("Cache write", point.cacheCreate)}
      ${tooltipRow("Output", point.output)}
      ${tooltipRow("Reasoning", point.reasoning)}
      ${tooltipRow("Cache read (reused)", point.cacheRead, true)}
    </div>
  `;
}

function metricSeries(name, key, points, color, options = {}) {
  return {
    type: "line",
    name,
    yAxisIndex: options.yAxisIndex || 0,
    data: points.map((point) => ({
      value: [point.timestamp, key === "new" ? newLoad(point) : Number(point[key] || 0)],
      event: point,
    })),
    showSymbol: false,
    symbol: "circle",
    symbolSize: 5,
    smooth: false,
    lineStyle: { color, width: options.width || 1.8, type: options.type || "solid" },
    itemStyle: { color },
    emphasis: { focus: "series", scale: 1.35 },
  };
}

function promptSeries(prompts, options = {}) {
  return {
    type: "scatter",
    name: "Prompts",
    data: prompts.map((prompt) => ({ value: [prompt.timestamp, 0], prompt })),
    symbol: "diamond",
    symbolSize: options.large ? 10 : 7,
    itemStyle: { color: colors.prompt, borderColor: "#101417", borderWidth: 1 },
    tooltip: { trigger: "item", formatter: (param) => tokenTooltip([param]) },
    z: 10,
  };
}

function promptMarkLines(prompts) {
  return prompts.map((prompt) => ({
    xAxis: prompt.timestamp,
    lineStyle: { color: colors.prompt, type: "dotted", width: 1 },
  }));
}

function promptLineSeries(prompts, visible = true) {
  return {
    id: "prompt-lines",
    type: "line",
    name: "Prompts",
    data: [],
    symbol: "none",
    lineStyle: { opacity: 0 },
    tooltip: { show: false },
    markLine: {
      silent: true,
      symbol: "none",
      label: { show: false },
      data: visible ? promptMarkLines(prompts) : [],
    },
  };
}

function drawTokenLine(element, points, prompts = [], options = {}, currentChart = null) {
  const visible = options.limit === 0 ? points : points.slice(-(options.limit || 120));
  const firstTime = visible[0] ? new Date(visible[0].timestamp).getTime() : 0;
  const lastTime = visible[visible.length - 1] ? new Date(visible[visible.length - 1].timestamp).getTime() : Date.now();
  const visiblePrompts = options.promptWindow
    ? prompts
    : prompts.filter((prompt) => {
        const time = new Date(prompt.timestamp).getTime();
        return time >= firstTime && time <= lastTime;
      });
  const values = visible.map((p) => newLoad(p));
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const lineColor = visible[visible.length - 1]?.source === "claude" ? colors.claude : colors.codex;
  const breakdown = Boolean(options.breakdown);
  const chart = currentChart || echarts.init(element, null, { renderer: "canvas" });
  const compact = element.getBoundingClientRect().width < 520;
  const previousLegend = currentChart?.getOption()?.legend?.[0]?.selected || {};
  const promptsVisible = previousLegend.Prompts !== false;
  const yAxis = breakdown
    ? [
        {
          type: "value",
          name: "new",
          min: 0,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: options.large, color: colors.muted, formatter: formatNumber },
          splitLine: { lineStyle: { color: colors.grid } },
        },
        {
          type: "value",
          name: "cache read",
          min: 0,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: options.large, color: colors.muted, formatter: formatNumber },
          splitLine: { show: false },
        },
      ]
    : {
        type: "value",
        min: 0,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          show: options.large,
          color: colors.muted,
          formatter: formatNumber,
        },
        splitLine: { lineStyle: { color: colors.grid } },
      };
  const series = breakdown
    ? [
        metricSeries("New tokens", "new", visible, lineColor, { width: 2.4 }),
        metricSeries("Fresh input", "input", visible, colors.fresh),
        metricSeries("Cache write", "cacheCreate", visible, colors.cache),
        metricSeries("Output", "output", visible, colors.output),
        metricSeries("Reasoning", "reasoning", visible, colors.reasoning),
        metricSeries("Cache read", "cacheRead", visible, "#9aa9ff", { yAxisIndex: 1, type: "dashed" }),
        promptSeries(visiblePrompts, { large: options.large }),
        promptLineSeries(visiblePrompts, promptsVisible),
      ]
    : [
        {
          type: "line",
          name: "New tokens",
          data: visible.map((point) => ({ value: [point.timestamp, newLoad(point)], event: point })),
          showSymbol: visible.length === 1,
          symbol: "circle",
          symbolSize: options.large ? 6 : 5,
          smooth: false,
          lineStyle: { color: lineColor, width: options.large ? 2.5 : 2 },
          itemStyle: { color: lineColor },
          emphasis: { focus: "series", scale: 1.4 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: lineColor + "66" },
              { offset: 1, color: lineColor + "06" },
            ]),
          },
          markPoint: {
            symbol: "circle",
            symbolSize: 9,
            label: { show: false },
            itemStyle: { color: colors.hot, borderColor: "#101417", borderWidth: 1.5 },
            data: [{ type: "max", name: "Spike" }],
          },
          markLine: options.large
            ? {
                silent: true,
                symbol: "none",
                label: {
                  color: colors.muted,
                  formatter: `avg ${formatNumber(average)}`,
                  position: "insideEndTop",
                },
                lineStyle: { color: "#80919a", type: "dashed", width: 1 },
                data: [{ yAxis: average }],
              }
            : undefined,
        },
        promptSeries(visiblePrompts, { large: options.large }),
      ];

  if (breakdown) {
    series[0].markPoint = {
      symbol: "circle",
      symbolSize: 9,
      label: { show: false },
      itemStyle: { color: colors.hot, borderColor: "#101417", borderWidth: 1.5 },
      data: [{ type: "max", name: "Spike" }],
    };
    series[0].markLine = {
      silent: true,
      symbol: "none",
      label: { color: colors.muted, formatter: `avg ${formatNumber(average)}`, position: "insideEndTop" },
      lineStyle: { color: "#80919a", type: "dashed", width: 1 },
      data: [{ yAxis: average }],
    };
  }

  chart.setOption({
    animation: false,
    grid: options.large
      ? {
          top: breakdown ? (compact ? 126 : 54) : 28,
          right: breakdown ? (compact ? 52 : 68) : 24,
          bottom: 58,
          left: compact ? 54 : 68,
        }
      : { top: 14, right: 10, bottom: 14, left: 10 },
    legend: {
      show: breakdown,
      type: compact ? "scroll" : "plain",
      top: compact ? 40 : 8,
      left: compact ? 0 : 64,
      right: compact ? 0 : undefined,
      height: compact ? 72 : undefined,
      itemWidth: 14,
      itemHeight: 8,
      pageIconColor: colors.muted,
      pageIconInactiveColor: "#4b5960",
      pageTextStyle: { color: colors.muted },
      textStyle: { color: colors.muted },
      selected: { "Cache read": true, Reasoning: true, ...previousLegend },
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "#11181c",
      borderColor: "#40515a",
      borderWidth: 1,
      padding: 0,
      textStyle: { color: colors.text, fontSize: 12 },
      axisPointer: { type: "line", lineStyle: { color: "#77909b", type: "dashed" } },
      formatter: tokenTooltip,
    },
    xAxis: {
      type: "time",
      boundaryGap: false,
      axisLine: { show: options.large, lineStyle: { color: colors.grid } },
      axisTick: { show: false },
      axisLabel: {
        show: options.large,
        color: colors.muted,
        hideOverlap: true,
        formatter: (value) => timeLabel(value),
      },
      splitLine: { show: false },
    },
    yAxis,
    dataZoom: options.large
      ? [
          { type: "inside", filterMode: "none" },
          {
            type: "slider",
            height: 16,
            bottom: 8,
            borderColor: colors.grid,
            backgroundColor: "#151d21",
            fillerColor: lineColor + "35",
            dataBackground: { lineStyle: { color: lineColor }, areaStyle: { color: lineColor + "22" } },
            selectedDataBackground: { lineStyle: { color: lineColor }, areaStyle: { color: lineColor + "44" } },
            handleStyle: { color: lineColor, borderColor: lineColor },
            textStyle: { color: colors.muted },
          },
        ]
      : [],
    series,
  }, { notMerge: true });
  chart.off("legendselectchanged");
  chart.on("legendselectchanged", (event) => {
    if (!breakdown || event.name !== "Prompts") return;
    chart.setOption({
      series: [
        {
          id: "prompt-lines",
          markLine: { data: event.selected.Prompts ? promptMarkLines(visiblePrompts) : [] },
        },
      ],
    });
  });
  return chart;
}

function projectStats(points) {
  const values = points.map((p) => newLoad(p));
  const latest = points[points.length - 1];
  const spike = points.reduce((best, p) => (newLoad(p) > newLoad(best) ? p : best), null);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return { latest, spike, average };
}

function dataSignature(points, limit, prompts = []) {
  return points
    .slice(-limit)
    .map((point) => `${point.id}:${newLoad(point)}`)
    .join("|") + `::${prompts.map((prompt) => prompt.id).join("|")}`;
}

function dailySignature(points) {
  return points.map((point) => `${point.id}:${newLoad(point)}`).join("|");
}

function renderDailyChart(points) {
  const element = $("dailyChart");
  const signature = dailySignature(points);
  if (signature === state.dailySignature && state.dailyChart) return;
  state.dailySignature = signature;

  const groups = new Map();
  for (const point of points) {
    const key = dayKey(point.timestamp);
    if (!groups.has(key)) groups.set(key, { day: key, total: 0, events: 0, spike: 0 });
    const group = groups.get(key);
    const value = newLoad(point);
    group.total += value;
    group.events += 1;
    group.spike = Math.max(group.spike, value);
  }
  const rows = [...groups.values()].sort((a, b) => a.day.localeCompare(b.day));
  const chart = state.dailyChart || echarts.init(element, null, { renderer: "canvas" });
  state.dailyChart = chart;
  chart.setOption({
    animation: false,
    grid: { top: 20, right: 64, bottom: 32, left: 64 },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "#11181c",
      borderColor: "#40515a",
      borderWidth: 1,
      textStyle: { color: colors.text, fontSize: 12 },
      formatter: (params) => {
        const row = rows[params[0].dataIndex];
        return `
          <div class="chart-tooltip">
            <div class="chart-tooltip-time">${escapeHtml(row.day)}</div>
            ${tooltipRow("Daily total", row.total)}
            ${tooltipRow("Avg per call", row.total / Math.max(1, row.events))}
            ${tooltipRow("Events", row.events)}
            ${tooltipRow("Spike", row.spike)}
          </div>
        `;
      },
    },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.day),
      axisLine: { lineStyle: { color: colors.grid } },
      axisTick: { show: false },
      axisLabel: { color: colors.muted },
    },
    yAxis: [
      {
        type: "value",
        name: "total",
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: colors.muted, formatter: formatNumber },
        splitLine: { lineStyle: { color: colors.grid } },
      },
      {
        type: "value",
        name: "avg",
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: colors.muted, formatter: formatNumber },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        type: "bar",
        name: "Daily total",
        data: rows.map((row) => row.total),
        itemStyle: { color: colors.fresh, opacity: 0.55, borderRadius: [4, 4, 0, 0] },
      },
      {
        type: "line",
        name: "Avg per call",
        yAxisIndex: 1,
        data: rows.map((row) => row.total / Math.max(1, row.events)),
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { color: colors.cache, width: 2 },
        itemStyle: { color: colors.cache },
      },
    ],
  }, { notMerge: true });
}

function renderSummary(points) {
  const last = points[points.length - 1];
  const spike = points.reduce((best, p) => (newLoad(p) > newLoad(best) ? p : best), null);

  $("lastTotal").textContent = formatNumber(last?.total || 0);
  $("lastInput").textContent = formatNumber(newLoad(last));
  $("lastOutput").textContent = formatNumber(last?.output || 0);
  $("lastSource").textContent = last ? `${last.source} · ${last.project || "unknown"} · ${timeLabel(last.timestamp)}` : "no data";
  $("spike").textContent = formatNumber(newLoad(spike));
  $("spikeLabel").textContent = spike ? `${spike.source} · ${spike.project || "unknown"} · ${timeLabel(spike.timestamp)}` : "max turn";
}

function groupedProjects(points) {
  const groups = new Map();
  for (const p of points) {
    const key = projectKey(p);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        source: p.source,
        project: p.project || "unknown",
        projectPath: p.projectPath || "",
        events: 0,
        total: 0,
        fresh: 0,
        lastTimestamp: p.timestamp,
      });
    }
    const group = groups.get(key);
    group.events += 1;
    group.total += Number(p.total || 0);
    group.fresh += newLoad(p);
    if (new Date(p.timestamp) > new Date(group.lastTimestamp)) group.lastTimestamp = p.timestamp;
  }
  return [...groups.values()].sort((a, b) => {
    const sourceOrder = a.source.localeCompare(b.source);
    if (sourceOrder) return sourceOrder;
    return a.project.localeCompare(b.project);
  });
}

function chunk(items, size) {
  const pages = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

function projectChartPages(groups) {
  const search = state.projectSearch.trim().toLowerCase();
  const matches = groups
    .filter((group) => {
      if (!search) return true;
      return `${group.source} ${group.project} ${group.projectPath}`.toLowerCase().includes(search);
    })
    .sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());

  if (search || state.project !== "all") return { pages: chunk(matches, 12), total: matches.length };

  const recentCodex = matches.filter((group) => group.source === "codex").slice(0, 3);
  const recentClaude = matches.filter((group) => group.source === "claude").slice(0, 3);
  const firstPage = state.source === "codex" ? recentCodex : state.source === "claude" ? recentClaude : [...recentCodex, ...recentClaude];
  const firstKeys = new Set(firstPage.map((group) => group.key));
  const remaining = matches.filter((group) => !firstKeys.has(group.key));
  return { pages: [firstPage, ...chunk(remaining, 12)].filter((page) => page.length), total: matches.length };
}

function renderProjectCharts(points) {
  const container = $("projectCharts");
  const allGroups = groupedProjects(points);
  const { pages, total } = projectChartPages(allGroups);
  state.projectPage = Math.min(state.projectPage, Math.max(0, pages.length - 1));
  const groups = pages[state.projectPage] || [];
  $("projectPageMeta").textContent = pages.length
    ? `Page ${state.projectPage + 1} of ${pages.length} · ${total} projects`
    : "0 projects";
  $("prevProjects").disabled = state.projectPage <= 0;
  $("nextProjects").disabled = state.projectPage >= pages.length - 1;
  const projectKeys = groups.map((group) => group.key);
  const needsRebuild =
    projectKeys.length !== state.chartProjectKeys.length ||
    projectKeys.some((key, index) => key !== state.chartProjectKeys[index]);

  if (needsRebuild) {
    state.projectCharts.forEach((chart) => chart.dispose());
    state.projectCharts = [];
    state.chartProjectKeys = projectKeys;
    state.chartDataSignatures = [];

    container.innerHTML = groups
      .map(
        (group, index) => `
          <div class="project-chart">
            <div class="project-chart-head">
              <div>
                <div class="project-chart-title">${escapeHtml(group.source)} / ${escapeHtml(group.project)}</div>
                <div class="project-chart-subtitle">${escapeHtml(nicePath(group.projectPath))}</div>
              </div>
              <div class="project-chart-actions">
                <div id="projectMeta${index}" class="project-chart-meta"></div>
                <button class="icon-button" type="button" data-project-index="${index}">Open</button>
              </div>
            </div>
            <div id="projectChart${index}" class="token-chart"></div>
          </div>
        `
      )
      .join("");

    container.querySelectorAll("[data-project-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const group = groups[Number(button.dataset.projectIndex)];
        if (group) openProjectModal(group.key);
      });
    });
  }

  groups.forEach((group, index) => {
    const element = $(`projectChart${index}`);
    const groupPoints = points.filter((p) => projectKey(p) === group.key);
    const groupPrompts = state.prompts.filter((p) => projectKey(p) === group.key);
    const stats = projectStats(groupPoints);
    const signature = dataSignature(groupPoints, 60, groupPrompts);
    $(`projectMeta${index}`).innerHTML = `
      <div>${group.events} events</div>
      <div>${formatNumber(newLoad(stats.latest))} <span class="help-label" tabindex="0" data-tooltip="New tokens added by the latest turn.">last</span></div>
      <div>${formatNumber(stats.average)} <span class="help-label" tabindex="0" data-tooltip="Average new tokens per turn in this project.">avg</span></div>
      <div>${formatNumber(newLoad(stats.spike))} <span class="help-label" tabindex="0" data-tooltip="Largest new-token event in this project.">spike</span></div>
    `;
    if (element && signature !== state.chartDataSignatures[index]) {
      state.projectCharts[index] = drawTokenLine(element, groupPoints, groupPrompts, { limit: 60 }, state.projectCharts[index]);
      state.chartDataSignatures[index] = signature;
    }
  });
}

function modalProjectPoints() {
  if (!state.modalProject) return [];
  return state.rawPoints.filter((p) => projectKey(p) === state.modalProject);
}

function modalProjectPrompts() {
  if (!state.modalProject) return [];
  return state.rawPrompts.filter((p) => projectKey(p) === state.modalProject);
}

function modalWindowMs(value) {
  if (value === "5m") return 5 * 60 * 1000;
  if (value === "10m") return 10 * 60 * 1000;
  if (value === "1h") return 60 * 60 * 1000;
  if (value === "6h") return 6 * 60 * 60 * 1000;
  if (value === "24h") return 24 * 60 * 60 * 1000;
  return null;
}

function modalPromptCount(value) {
  const match = /^p(\d+)$/.exec(value || "");
  return match ? Number(match[1]) : null;
}

function tokenSums(points) {
  return points.reduce(
    (sum, point) => {
      sum.newTokens += newLoad(point);
      sum.input += Number(point.input || 0);
      sum.cacheCreate += Number(point.cacheCreate || 0);
      sum.cacheRead += Number(point.cacheRead || 0);
      sum.output += Number(point.output || 0);
      sum.reasoning += Number(point.reasoning || 0);
      return sum;
    },
    { newTokens: 0, input: 0, cacheCreate: 0, cacheRead: 0, output: 0, reasoning: 0 }
  );
}

function renderModalSum(points) {
  const panel = $("modalSum");
  const button = $("modalSumToggle");
  button.classList.toggle("active", state.modalSumVisible);
  panel.hidden = !state.modalSumVisible;
  if (!state.modalSumVisible) return;

  const sums = tokenSums(points);
  panel.innerHTML = `
    <div class="sum-card"><span class="help-label" tabindex="0" data-tooltip="Sum of fresh input, cache write, output and reasoning in the current detail filter.">New tokens</span><strong>${formatNumber(sums.newTokens)}</strong></div>
    <div class="sum-card"><span class="help-label" tabindex="0" data-tooltip="Fresh input tokens summed across events visible in the current detail filter.">Fresh input</span><strong>${formatNumber(sums.input)}</strong></div>
    <div class="sum-card"><span class="help-label" tabindex="0" data-tooltip="Cache write tokens summed across events visible in the current detail filter.">Cache write</span><strong>${formatNumber(sums.cacheCreate)}</strong></div>
    <div class="sum-card"><span class="help-label" tabindex="0" data-tooltip="Cache read tokens summed across events visible in the current detail filter. These are reused context tokens.">Cache read</span><strong>${formatNumber(sums.cacheRead)}</strong></div>
    <div class="sum-card"><span class="help-label" tabindex="0" data-tooltip="Assistant output tokens summed across events visible in the current detail filter.">Output</span><strong>${formatNumber(sums.output)}</strong></div>
    <div class="sum-card"><span class="help-label" tabindex="0" data-tooltip="Reasoning tokens summed across events visible in the current detail filter.">Reasoning</span><strong>${formatNumber(sums.reasoning)}</strong></div>
  `;
}

function filterModalWindow(points, prompts) {
  if (!points.length) return { points, prompts };
  const end = new Date(points[points.length - 1].timestamp).getTime();
  const promptCount = modalPromptCount(state.modalWindow);
  if (promptCount) {
    const sortedPrompts = prompts
      .filter((prompt) => {
        const time = new Date(prompt.timestamp).getTime();
        return !Number.isNaN(time) && time <= end;
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const anchor = sortedPrompts[Math.max(0, sortedPrompts.length - promptCount)];
    if (!anchor) return { points, prompts: [] };
    const start = new Date(anchor.timestamp).getTime();
    return {
      points: points.filter((p) => {
        const time = new Date(p.timestamp).getTime();
        return time >= start && time <= end;
      }),
      prompts: sortedPrompts.filter((prompt) => {
        const time = new Date(prompt.timestamp).getTime();
        return time >= start && time <= end;
      }),
    };
  }

  const ms = modalWindowMs(state.modalWindow);
  if (!ms) return { points, prompts };
  const start = end - ms;
  return {
    points: points.filter((p) => new Date(p.timestamp).getTime() >= start),
    prompts: prompts.filter((p) => {
      const time = new Date(p.timestamp).getTime();
      return time >= start && time <= end;
    }),
  };
}

function renderModalRangeButtons() {
  const promptCount = modalPromptCount(state.modalWindow);
  $("modalTimeFilter").value = promptCount ? "all" : state.modalWindow;
  $("modalPromptFilter").value = promptCount ? state.modalWindow : "";
}

function renderModalChart() {
  const allPoints = modalProjectPoints();
  const allPrompts = modalProjectPrompts();
  const { points, prompts } = filterModalWindow(allPoints, allPrompts);
  renderModalRangeButtons();
  if (!points.length) return;
  renderModalSum(points);

  const group = groupedProjects(allPoints)[0];
  const stats = projectStats(points);
  $("modalTitle").textContent = `${group.source} / ${group.project}`;
  $("modalSubtitle").textContent = group.projectPath || "";
  $("modalStats").innerHTML = `
    <div class="modal-stat"><span class="help-label" tabindex="0" data-tooltip="Token events currently visible in this detailed chart window.">Events</span><strong>${points.length}</strong></div>
    <div class="modal-stat"><span class="help-label" tabindex="0" data-tooltip="New tokens added by the latest turn.">Last</span><strong>${formatNumber(newLoad(stats.latest))}</strong></div>
    <div class="modal-stat"><span class="help-label" tabindex="0" data-tooltip="Average new tokens per turn in this project.">Average</span><strong>${formatNumber(stats.average)}</strong></div>
    <div class="modal-stat"><span class="help-label" tabindex="0" data-tooltip="Largest new-token event in this project.">Spike</span><strong>${formatNumber(newLoad(stats.spike))}</strong></div>
  `;
  const signature = `${state.modalWindow}:${dataSignature(points, 0, prompts)}`;
  if (signature !== state.modalDataSignature) {
    state.modalChart = drawTokenLine($("modalChart"), points, prompts, {
      limit: 0,
      large: true,
      breakdown: true,
      promptWindow: Boolean(modalPromptCount(state.modalWindow)),
    }, state.modalChart);
    state.modalDataSignature = signature;
  }
}

function openProjectModal(key) {
  state.modalProject = key;
  state.modalWindow = "all";
  state.modalSumVisible = false;
  state.modalDataSignature = "";
  $("chartModal").hidden = false;
  renderModalChart();
}

function closeProjectModal() {
  state.modalProject = null;
  if (state.modalChart) state.modalChart.dispose();
  state.modalChart = null;
  state.modalDataSignature = "";
  state.modalWindow = "all";
  state.modalSumVisible = false;
  $("modalSum").hidden = true;
  $("chartModal").hidden = true;
}

function populateFilters(points) {
  const sourceFilter = $("sourceFilter");
  const projectFilter = $("projectFilter");

  sourceFilter.innerHTML = `
    <option value="all">All</option>
    <option value="codex">Codex</option>
    <option value="claude">Claude</option>
  `;
  sourceFilter.value = state.source;

  const rows = groupedProjects(points).filter((row) => state.source === "all" || row.source === state.source);
  const options = rows
    .map((row) => `<option value="${escapeHtml(row.key)}">${escapeHtml(row.source)} / ${escapeHtml(row.project)}</option>`)
    .join("");
  projectFilter.innerHTML = `<option value="all">All projects</option>${options}`;
  if (![...projectFilter.options].some((option) => option.value === state.project)) state.project = "all";
  projectFilter.value = state.project;
}

function filteredPoints() {
  return state.rawPoints.filter((p) => {
    if (state.source !== "all" && p.source !== state.source) return false;
    if (state.project !== "all" && projectKey(p) !== state.project) return false;
    return true;
  });
}

function filteredPrompts() {
  return state.rawPrompts.filter((p) => {
    if (state.source !== "all" && p.source !== state.source) return false;
    if (state.project !== "all" && projectKey(p) !== state.project) return false;
    return true;
  });
}

function renderAll() {
  populateFilters(state.rawPoints);
  state.points = filteredPoints();
  state.prompts = filteredPrompts();
  $("rangeFilter").value = state.range;
  $("filterMeta").textContent = `${state.points.length} events · ${state.prompts.length} prompts`;
  renderSummary(state.points);
  renderDailyChart(state.points);
  renderProjectCharts(state.points);
  if (state.modalProject) renderModalChart();
}

async function load() {
  if (state.loading) return;
  state.loading = true;
  try {
    const response = await fetch(`/api/usage?range=${encodeURIComponent(state.range)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.data = data;
    state.rawPoints = data.points || [];
    state.rawPrompts = data.prompts || [];

    $("health").textContent = "live";
    $("health").classList.add("ok");
    $("updated").textContent = new Date(data.generatedAt).toLocaleTimeString();

    renderAll();
  } catch (error) {
    $("health").textContent = "error";
    $("health").classList.remove("ok");
    $("updated").textContent = String(error.message || error);
  } finally {
    state.loading = false;
    window.setTimeout(load, 2000);
  }
}

window.addEventListener("resize", () => {
  if (state.dailyChart) state.dailyChart.resize();
  state.projectCharts.forEach((chart) => chart.resize());
  if (state.modalChart) state.modalChart.resize();
});

$("modalClose").addEventListener("click", closeProjectModal);

$("chartModal").addEventListener("click", (event) => {
  if (event.target === $("chartModal")) closeProjectModal();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.modalProject) closeProjectModal();
});

$("modalTimeFilter").addEventListener("change", (event) => {
  state.modalWindow = event.target.value;
  state.modalDataSignature = "";
  renderModalChart();
  if (state.modalChart) state.modalChart.resize();
});

$("modalPromptFilter").addEventListener("change", (event) => {
  state.modalWindow = event.target.value || $("modalTimeFilter").value || "all";
  state.modalDataSignature = "";
  renderModalChart();
  if (state.modalChart) state.modalChart.resize();
});

$("modalSumToggle").addEventListener("click", () => {
  state.modalSumVisible = !state.modalSumVisible;
  renderModalChart();
  if (state.modalChart) state.modalChart.resize();
});

$("rangeFilter").addEventListener("change", (event) => {
  state.range = event.target.value;
  state.projectPage = 0;
  state.dailySignature = "";
  state.chartProjectKeys = [];
  state.modalDataSignature = "";
  load();
});

$("sourceFilter").addEventListener("change", (event) => {
  state.source = event.target.value;
  state.project = "all";
  state.projectPage = 0;
  state.dailySignature = "";
  state.chartProjectKeys = [];
  renderAll();
});

$("projectFilter").addEventListener("change", (event) => {
  state.project = event.target.value;
  state.projectPage = 0;
  state.dailySignature = "";
  state.chartProjectKeys = [];
  renderAll();
});

$("projectSearch").addEventListener("input", (event) => {
  state.projectSearch = event.target.value;
  state.projectPage = 0;
  state.chartProjectKeys = [];
  renderProjectCharts(state.points);
});

$("prevProjects").addEventListener("click", () => {
  if (state.projectPage <= 0) return;
  state.projectPage -= 1;
  state.chartProjectKeys = [];
  renderProjectCharts(state.points);
});

$("nextProjects").addEventListener("click", () => {
  state.projectPage += 1;
  state.chartProjectKeys = [];
  renderProjectCharts(state.points);
});

load();

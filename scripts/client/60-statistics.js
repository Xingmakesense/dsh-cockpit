        // -------------------------------------------------------------------
        // Statistics page: settings.section native port of dsh-watcher's
        // InsightsSettings. The Host owns the projection fold and merges the
        // views; this page only renders the range-scoped summary.
        // -------------------------------------------------------------------
        const STATS_ROUTE = "api/cockpit/stats";
        const STATS_RANGE_OPTIONS = [
            ["1", "rangeToday"],
            ["7", "range7"],
            ["30", "range30"],
            ["180", "range180"],
            ["all", "rangeAll"]
        ];
        const STATS_PALETTE = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ec4899", "#6366f1"];
        const STATS_WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
        const STATS_SORT_OPTIONS = [
            ["tokens", "sortTokens"],
            ["time", "sortTime"],
            ["errors", "sortErrors"]
        ];

        const formatStatInt = (value) => {
            const number = Number.isFinite(value) ? Math.round(value) : 0;
            return String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        };
        const formatStatCompact = (value) => {
            const number = Number.isFinite(value) ? value : 0;
            if (number <= 0) return "0";
            if (number >= 1e8) return (number / 1e8).toFixed(1) + " 亿";
            if (number >= 1e4) return (number / 1e4).toFixed(1) + " 万";
            return formatStatInt(number);
        };
        const formatStatSeconds = (ms) => {
            const number = Number.isFinite(ms) ? ms : 0;
            if (number >= 3600000) return (number / 3600000).toFixed(1) + "h";
            if (number >= 60000) return (number / 60000).toFixed(1) + "min";
            return Math.round(number / 1000) + "s";
        };
        const formatStatDate = (ms) => {
            if (!Number.isFinite(ms) || ms <= 0) return "-";
            const date = new Date(ms);
            return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
        };

        async function fetchCockpitStats({ range = "7", sort = "tokens", fields = "summary", sessionId = null } = {}) {
            const query = STATS_ROUTE + "?range=" + encodeURIComponent(range) + "&sort=" + encodeURIComponent(sort) + "&fields=" + encodeURIComponent(fields);
            const target = sessionId ? query + "&sessionId=" + encodeURIComponent(sessionId) : query;
            const response = await fetch(target, {
                method: "GET",
                cache: "no-store",
                headers: { accept: "application/json" }
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload || payload.ok === false) {
                throw new Error(payload?.error?.message ?? "statistics request failed: HTTP " + response.status);
            }
            return payload.value;
        }

        /** Stacked spline geometry for the trend line mode (ported from watcher). */
        function computeStackedLineChart(daySeries, modelsList, width = 560, height = 160) {
            const padding = { top: 20, right: 20, bottom: 28, left: 45 };
            const plotW = Math.max(10, width - padding.left - padding.right);
            const plotH = Math.max(10, height - padding.top - padding.bottom);
            const bottomY = padding.top + plotH;
            const maxValue = Math.max(1, ...daySeries.map((day) => day.total));
            const yMax = Math.ceil(maxValue * 1.15);
            const yCoord = (value) => bottomY - (value / yMax) * plotH;
            const effectiveModels = modelsList.length > 0
                ? modelsList
                : [{ model: "全部模型", color: "#5686fe", tokens: maxValue, pct: 100 }];
            const stackLevels = daySeries.map((day, dayIndex) => {
                const x = padding.left + (dayIndex / Math.max(1, daySeries.length - 1)) * plotW;
                let acc = 0;
                const modelStacks = effectiveModels.map((model) => {
                    const segment = day.segments.find((entry) => entry.model === model.model);
                    const tokens = segment ? segment.tokens : 0;
                    const bottom = acc;
                    acc += tokens;
                    return {
                        model: model.model,
                        color: model.color,
                        tokens,
                        bottomY: yCoord(bottom),
                        topY: yCoord(acc)
                    };
                });
                return { index: dayIndex, x, total: day.total, data: day, modelStacks };
            });
            const buildSpline = (points) => {
                if (points.length <= 1) return points.length === 1 ? "M " + points[0].x.toFixed(1) + " " + points[0].y.toFixed(1) : "";
                let path = "M " + points[0].x.toFixed(1) + " " + points[0].y.toFixed(1);
                for (let index = 0; index < points.length - 1; index++) {
                    const p0 = points[Math.max(0, index - 1)];
                    const p1 = points[index];
                    const p2 = points[index + 1];
                    const p3 = points[Math.min(points.length - 1, index + 2)];
                    const cp1x = p1.x + (p2.x - p0.x) / 6;
                    const cp1y = Math.min(bottomY, Math.max(padding.top, p1.y + (p2.y - p0.y) / 6));
                    const cp2x = p2.x - (p3.x - p1.x) / 6;
                    const cp2y = Math.min(bottomY, Math.max(padding.top, p2.y - (p3.y - p1.y) / 6));
                    path += " C " + cp1x.toFixed(1) + " " + cp1y.toFixed(1) + ", " + cp2x.toFixed(1) + " " + cp2y.toFixed(1) + ", " + p2.x.toFixed(1) + " " + p2.y.toFixed(1);
                }
                return path;
            };
            const buildSegmentSpline = (points) => {
                let path = "";
                for (let index = 0; index < points.length - 1; index++) {
                    const p0 = points[Math.max(0, index - 1)];
                    const p1 = points[index];
                    const p2 = points[index + 1];
                    const p3 = points[Math.min(points.length - 1, index + 2)];
                    const cp1x = p1.x + (p2.x - p0.x) / 6;
                    const cp1y = Math.min(bottomY, Math.max(padding.top, p1.y + (p2.y - p0.y) / 6));
                    const cp2x = p2.x - (p3.x - p1.x) / 6;
                    const cp2y = Math.min(bottomY, Math.max(padding.top, p2.y - (p3.y - p1.y) / 6));
                    path += " C " + cp1x.toFixed(1) + " " + cp1y.toFixed(1) + ", " + cp2x.toFixed(1) + " " + cp2y.toFixed(1) + ", " + p2.x.toFixed(1) + " " + p2.y.toFixed(1);
                }
                return path;
            };
            const layers = effectiveModels.map((model, modelIndex) => {
                const topPoints = stackLevels.map((level) => ({ x: level.x, y: level.modelStacks[modelIndex].topY }));
                const bottomPoints = stackLevels.map((level) => ({ x: level.x, y: level.modelStacks[modelIndex].bottomY }));
                const lineD = buildSpline(topPoints);
                const reversed = [...bottomPoints].reverse();
                const areaD = lineD + " L " + reversed[0].x.toFixed(1) + " " + reversed[0].y.toFixed(1) + buildSegmentSpline(reversed) + " Z";
                return { model: model.model, color: model.color, lineD, areaD };
            });
            return { layers, stackLevels, yMax, bottomY, padding, plotW, plotH };
        }

        const statsPanelStyle = {
            ...cardBase,
            padding: "16px 18px",
            boxShadow: "none",
            marginTop: 16
        };
        const statsPanelHead = {
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 12
        };
        const statsTitleStyle = { fontSize: 15, fontWeight: 700, color: THEME.text, margin: 0 };
        const statsSubStyle = { fontSize: 12, color: THEME.textSecondary, lineHeight: 1.5, margin: "3px 0 0" };
        const statsSmallButton = { ...ghostButtonStyle, padding: "5px 10px", fontSize: 12 };
        const statsActiveButton = { ...statsSmallButton, background: THEME.accent, borderColor: "transparent", color: THEME.onAccent };
        const statsMono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" };
        const statsRankName = {
            flex: "1 1 auto",
            minWidth: 0,
            fontSize: 13,
            fontWeight: 600,
            color: THEME.text,
            whiteSpace: "normal",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
            lineHeight: 1.45
        };
        const statsBarTrack = { height: 8, borderRadius: 999, background: THEME.track, overflow: "hidden", margin: "7px 0 6px" };
        const statsBarFill = (pct, color) => ({ width: Math.max(2, Math.min(100, pct)) + "%", height: "100%", borderRadius: 999, background: color });
        const statsRowSub = { display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 11.5, color: THEME.textSecondary, lineHeight: 1.55 };

        function StatsStat({ label, value, hint }) {
            return h("div", { style: { minWidth: 120, flex: "1 1 120px" } },
                h("div", { style: { fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: THEME.textSecondary } }, label),
                h("div", { style: { fontSize: 22, fontWeight: 700, lineHeight: 1.35, ...statsMono } }, value),
                hint ? h("div", { style: { fontSize: 11, color: THEME.textSecondary } }, hint) : null
            );
        }

        function StatsModelTable({ t, summary }) {
            const models = summary.models ?? [];
            if (models.length === 0) {
                return h("div", { style: { fontSize: 13, color: THEME.textSecondary } }, t("modelsEmpty"));
            }
            const cell = { padding: "8px 6px", fontSize: 12, borderBottom: "1px solid " + THEME.border, verticalAlign: "top" };
            const headCell = { ...cell, fontSize: 11, color: THEME.textSecondary, fontWeight: 600, whiteSpace: "nowrap" };
            const align = { textAlign: "right", ...statsMono };
            return h("div", { style: { overflowX: "auto" } },
                h("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: 720 } },
                    h("thead", null,
                        h("tr", null,
                            h("th", { style: { ...headCell, textAlign: "left", minWidth: 210 } }, t("colModel")),
                            h("th", { style: { ...headCell, textAlign: "right" } }, t("colCalls")),
                            h("th", { style: { ...headCell, textAlign: "right" } }, t("colTokens")),
                            h("th", { style: { ...headCell, textAlign: "right" } }, t("colShare")),
                            h("th", { style: { ...headCell, textAlign: "right" } }, t("colCache")),
                            h("th", { style: { ...headCell, textAlign: "right" } }, t("colFirst")),
                            h("th", { style: { ...headCell, textAlign: "right" } }, t("colReasoning")),
                            h("th", { style: { ...headCell, textAlign: "right" } }, t("colTime"))
                        )
                    ),
                    h("tbody", null,
                        models.map((model) => h("tr", { key: model.model },
                            h("td", { style: { ...cell, minWidth: 210 } },
                                h("div", { style: { fontWeight: 600, lineHeight: 1.45, whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" } }, model.model),
                                model.effort ? h("div", { style: { fontSize: 11, color: THEME.textSecondary } }, model.effort) : null
                            ),
                            h("td", { style: { ...cell, ...align } }, formatStatInt(model.calls)),
                            h("td", { style: { ...cell, ...align } }, formatStatCompact(model.tokens)),
                            h("td", { style: { ...cell, ...align } }, model.tokensPct + "%"),
                            h("td", { style: { ...cell, ...align } }, model.cacheReports > 0 ? model.cacheHitPct + "%" : "—"),
                            h("td", { style: { ...cell, ...align } }, model.avgFirstMs === null ? "-" : (model.avgFirstMs / 1000).toFixed(2) + "s"),
                            h("td", { style: { ...cell, ...align } }, model.reasoningPct + "%"),
                            h("td", { style: { ...cell, ...align } }, formatStatSeconds(model.modelMs))
                        ))
                    )
                )
            );
        }

        function StatsRankItem({ index, name, value, pct, subLeft, subRight, color }) {
            return h("div", { style: { padding: "9px 0", borderBottom: "1px solid " + THEME.border } },
                h("div", { style: { display: "flex", alignItems: "flex-start", gap: 8 } },
                    h("span", {
                        style: {
                            flex: "none",
                            minWidth: 30,
                            height: 20,
                            lineHeight: "20px",
                            textAlign: "center",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 700,
                            color: index === 0 ? THEME.onAccent : THEME.textSecondary,
                            background: index === 0 ? THEME.accent : THEME.sunken
                        }
                    }, "#" + (index + 1)),
                    h("div", { style: { ...statsRankName } }, name),
                    h("span", { style: { flex: "none", fontSize: 13, fontWeight: 700, ...statsMono } }, value)
                ),
                h("div", { style: statsBarTrack }, h("div", { style: statsBarFill(pct, color) })),
                h("div", { style: statsRowSub }, h("span", null, subLeft), subRight ? h("span", null, subRight) : null)
            );
        }

        function StatsRankBoards({ t, summary }) {
            const boards = [
                {
                    key: "tools", title: t("rankTools"), sub: t("rankToolsSub", { count: summary.toolRank.length }),
                    rows: summary.toolRank, max: summary.toolRank[0]?.stepTokens || 1,
                    total: summary.toolTokensSum, color: "#3b82f6",
                    value: (row) => row.stepTokens,
                    left: (row) => t("rankCalls", { calls: formatStatInt(row.calls) }) + (row.errors > 0 ? " · " + t("rankErrors", { errors: formatStatInt(row.errors) }) : ""),
                    right: (row) => t("rankTime", { time: formatStatSeconds(row.toolMs) }) + " · " + t("rankResult", { size: formatStatCompact(Math.round(row.resultChars / 1024)) + "KB" }),
                    empty: t("rankNoTool")
                },
                {
                    key: "skills", title: t("rankSkills"), sub: t("rankSkillsSub", { count: summary.skillRank.length }),
                    rows: summary.skillRank, max: summary.skillRank[0]?.stepTokens || 1,
                    total: summary.skillTokensSum, color: "#8b5cf6",
                    value: (row) => row.stepTokens,
                    left: (row) => {
                        const parts = [];
                        if (row.modelCalls > 0) parts.push(t("rankModelCalls", { calls: formatStatInt(row.modelCalls) }));
                        if (row.userCalls > 0) parts.push(t("rankUserCalls", { calls: formatStatInt(row.userCalls) }));
                        return (parts.join(" · ") || t("rankNeverCalled")) + (row.errors > 0 ? " · " + t("rankErrors", { errors: formatStatInt(row.errors) }) : "");
                    },
                    right: (row) => t("rankInject", { chars: formatStatCompact(row.injectedChars) }),
                    empty: t("rankNoSkill")
                },
                {
                    key: "workspaces", title: t("rankWorkspaces"), sub: t("rankWorkspacesSub", { count: summary.workspaceRank.length }),
                    rows: summary.workspaceRank, max: summary.workspaceRank[0]?.tokens || 1,
                    total: summary.workspaceTokensSum, color: "#f59e0b",
                    value: (row) => row.tokens,
                    left: (row) => t("rankSessions", { sessions: formatStatInt(row.sessions) }) + " · " + t("rankPrompts", { prompts: formatStatInt(row.prompts) }),
                    right: (row) => t("rankTime", { time: ((row.modelMs + row.toolMs) / 3600000).toFixed(1) + "h" }),
                    empty: t("rankNoWorkspace")
                }
            ];
            return h("div", { style: { display: "grid", gridTemplateColumns: "1fr", gap: 12 } },
                boards.map((board) => h("div", { key: board.key, style: { border: "1px solid " + THEME.border, borderRadius: 12, padding: "12px 14px", background: THEME.sunken } },
                    h("div", { style: { display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 4 } },
                        h("span", { style: { fontSize: 13, fontWeight: 700 } }, board.title),
                        h("span", { style: { fontSize: 11, color: THEME.textSecondary } }, board.sub)
                    ),
                    h("div", null,
                        board.rows.length === 0
                            ? h("div", { style: { fontSize: 12, color: THEME.textSecondary, padding: "8px 0" } }, board.empty)
                            : board.rows.map((row, index) => {
                                const raw = board.value(row) || 0;
                                const share = Math.round((raw / board.total) * 100);
                                const barPct = Math.max(4, Math.round((raw / board.max) * 100));
                                const name = board.key === "workspaces" ? row.label : row.name;
                                return h(StatsRankItem, {
                                    key: board.key + ":" + (row.cwd || row.name),
                                    index,
                                    name: name || t("rankUnknown"),
                                    value: formatStatCompact(raw),
                                    pct: barPct,
                                    subLeft: board.left(row),
                                    subRight: board.right(row) + (raw > 0 ? " · " + share + "%" : ""),
                                    color: board.color
                                });
                            })
                    )
                ))
            );
        }

        function StatsTrendPanel({ t, summary, viewMode, setViewMode }) {
            const daySeries = summary.daySeries ?? [];
            const activeModels = summary.activeRangeModels ?? [];
            const chart = viewMode === "line" ? computeStackedLineChart(daySeries, activeModels) : null;
            return h("div", { style: statsPanelStyle },
                h("div", { style: statsPanelHead },
                    h("div", null,
                        h("h3", { style: statsTitleStyle }, t("trendTitle")),
                        h("p", { style: statsSubStyle }, viewMode === "bar" ? t("trendBarSub") : t("trendLineSub"))
                    ),
                    h("div", { style: { display: "flex", gap: 6 } },
                        h("button", { type: "button", style: viewMode === "bar" ? statsActiveButton : statsSmallButton, onClick: () => setViewMode("bar") }, t("trendBar")),
                        h("button", { type: "button", style: viewMode === "line" ? statsActiveButton : statsSmallButton, onClick: () => setViewMode("line") }, t("trendLine"))
                    )
                ),
                activeModels.length > 0 ? h("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 } },
                    activeModels.map((model) => h("span", { key: model.model, style: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: THEME.textSecondary, maxWidth: 320 } },
                        h("i", { style: { width: 8, height: 8, borderRadius: 999, background: model.color, flex: "none" } }),
                        h("span", { style: { whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" } }, model.model + " " + formatStatCompact(model.tokens) + " (" + model.pct + "%)")
                    ))
                ) : null,
                viewMode === "bar"
                    ? h("div", { style: { overflowX: "auto", paddingBottom: 4 } },
                        h("div", { style: { display: "flex", alignItems: "flex-end", gap: daySeries.length > 31 ? 2 : 6, minWidth: Math.max(320, daySeries.length * (daySeries.length > 31 ? 7 : 22)), height: 190 } },
                            daySeries.map((day) => h("div", { key: day.key, style: { flex: "1 1 0", minWidth: daySeries.length > 31 ? 5 : 12, display: "flex", flexDirection: "column", alignItems: "stretch", height: "100%" } },
                                h("div", { style: { height: 18, fontSize: 10, textAlign: "center", color: THEME.textSecondary, ...statsMono, overflow: "hidden", whiteSpace: "nowrap" } }, day.total > 0 ? formatStatCompact(day.total) : ""),
                                h("div", { style: { flex: "1 1 auto", display: "flex", flexDirection: "column", justifyContent: "flex-end", minHeight: 60 } },
                                    day.total > 0
                                        ? day.segments.map((segment) => h("div", {
                                            key: segment.model,
                                            style: {
                                                height: ((segment.tokens / Math.max(1, summary.dayMax)) * 100) + "%",
                                                background: segment.color,
                                                minHeight: 1
                                            }
                                        }))
                                        : h("div", { style: { height: 3, borderRadius: 999, background: THEME.track } })
                                ),
                                h("div", { style: { height: 20, fontSize: 10, textAlign: "center", color: day.isToday ? THEME.accent : THEME.textSecondary, whiteSpace: "nowrap", overflow: "hidden" } }, day.label || day.key.slice(5))
                            ))
                        )
                    )
                    : h("div", { style: { overflowX: "auto" } },
                        h("svg", { viewBox: "0 0 560 160", preserveAspectRatio: "none", style: { width: "100%", minWidth: 420, height: "auto", display: "block" } },
                            chart.layers.map((layer) => h("path", { key: "area:" + layer.model, d: layer.areaD, fill: layer.color, fillOpacity: 0.16 })),
                            chart.layers.map((layer) => h("path", { key: "line:" + layer.model, d: layer.lineD, fill: "none", stroke: layer.color, strokeWidth: 2.2, strokeLinejoin: "round", strokeLinecap: "round" })),
                            h("text", { x: chart.padding.left - 6, y: chart.padding.top + 3, textAnchor: "end", fill: THEME.textSecondary, fontSize: 8 }, formatStatCompact(chart.yMax)),
                            h("text", { x: chart.padding.left - 6, y: chart.bottomY + 3, textAnchor: "end", fill: THEME.textSecondary, fontSize: 8 }, "0")
                        )
                    ),
                h("div", { style: { marginTop: 8, fontSize: 11.5, color: THEME.textSecondary, lineHeight: 1.6 } },
                    t("trendFoot", { turns: formatStatInt(summary.totalTurns), days: summary.days }))
            );
        }

        function StatsDistributionPanel({ t, summary }) {
            const weekdayMax = Math.max(1, summary.weekdayMax || 1);
            const shapeMax = Math.max(1, summary.shapeMax || 1);
            const shapeLabels = ["shape0", "shape1", "shape2", "shape3", "shape4", "shape5"];
            return h("div", { style: statsPanelStyle },
                h("div", { style: statsPanelHead },
                    h("div", null,
                        h("h3", { style: statsTitleStyle }, t("distributionTitle")),
                        h("p", { style: statsSubStyle }, t("distributionSub", { turns: formatStatInt(summary.scopedTurns) }))
                    )
                ),
                h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 } },
                    h("div", null,
                        h("div", { style: { fontSize: 12, fontWeight: 600, marginBottom: 6 } }, t("weekdayTitle")),
                        summary.weekdayTokens.map((tokens, index) => h("div", { key: "wd" + index, style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 5 } },
                            h("span", { style: { width: 34, flex: "none", fontSize: 11.5, color: THEME.textSecondary } }, "周" + STATS_WEEKDAYS[index]),
                            h("div", { style: { flex: "1 1 auto", height: 8, borderRadius: 999, background: THEME.track, overflow: "hidden" } },
                                h("div", { style: { width: (tokens > 0 ? Math.max(4, Math.round((tokens / weekdayMax) * 100)) : 0) + "%", height: "100%", background: THEME.accent } })
                            ),
                            h("span", { style: { width: 74, flex: "none", textAlign: "right", fontSize: 11, color: THEME.textSecondary, ...statsMono } }, tokens > 0 ? formatStatCompact(tokens) : "—")
                        )),
                        summary.busiest ? h("div", { style: { marginTop: 6, fontSize: 11.5, color: THEME.textSecondary } },
                            t("busiest", { day: STATS_WEEKDAYS[summary.busiest.wd], tokens: formatStatCompact(summary.busiest.tokens), turns: formatStatInt(summary.busiest.turns) })) : null
                    ),
                    h("div", null,
                        h("div", { style: { fontSize: 12, fontWeight: 600, marginBottom: 6 } }, t("shapeTitle")),
                        (summary.shapeBuckets ?? []).map((count, index) => h("div", { key: "shape" + index, style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 5 } },
                            h("span", { style: { width: 74, flex: "none", fontSize: 11.5, color: THEME.textSecondary } }, t(shapeLabels[index])),
                            h("div", { style: { flex: "1 1 auto", height: 8, borderRadius: 999, background: THEME.track, overflow: "hidden" } },
                                h("div", { style: { width: Math.round((count / shapeMax) * 100) + "%", height: "100%", background: "#8b5cf6" } })
                            ),
                            h("span", { style: { width: 52, flex: "none", textAlign: "right", fontSize: 11, color: THEME.textSecondary, ...statsMono } }, formatStatInt(count))
                        ))
                    )
                )
            );
        }

        function StatsSessionPanel({ t, summary, sort, setSort }) {
            const sessions = summary.sessions ?? [];
            const [open, setOpen] = React.useState(null);
            const cell = { padding: "8px 6px", borderBottom: "1px solid " + THEME.border, fontSize: 12, verticalAlign: "middle" };
            return h("div", { style: statsPanelStyle },
                h("div", { style: statsPanelHead },
                    h("div", null,
                        h("h3", { style: statsTitleStyle }, t("sessionsTitle")),
                        h("p", { style: statsSubStyle }, t("sessionsSub", { count: formatStatInt(summary.validCount), listed: formatStatInt(summary.listed) }))
                    ),
                    h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
                        STATS_SORT_OPTIONS.map(([value, label]) => h("button", {
                            key: value,
                            type: "button",
                            style: sort === value ? statsActiveButton : statsSmallButton,
                            onClick: () => setSort(value)
                        }, t(label)))
                    )
                ),
                sessions.length === 0
                    ? h("div", { style: { fontSize: 13, color: THEME.textSecondary } }, t("noStats"))
                    : h("div", { style: { overflowX: "auto" } },
                        h("div", { style: { minWidth: 720 } },
                            sessions.slice(0, 20).map((session, index) => {
                                const expanded = open === session.sessionId;
                                const statusText = session.status === "errors"
                                    ? t("statusErrors", { errors: formatStatInt(session.toolErrors) })
                                    : session.status === "retry"
                                        ? t("statusRetry", { retries: formatStatInt(session.retries) })
                                        : t("statusOk");
                                const statusColor = session.status === "errors" ? THEME.dangerText : session.status === "retry" ? THEME.warnText : THEME.successText;
                                return h("div", { key: session.sessionId },
                                    h("div", {
                                        role: "button",
                                        tabIndex: 0,
                                        onClick: () => setOpen(expanded ? null : session.sessionId),
                                        style: { display: "grid", gridTemplateColumns: "minmax(190px, 2fr) minmax(150px, 1.4fr) minmax(90px, 1fr) minmax(80px, 0.8fr) minmax(100px, 1fr) 22px", gap: 8, alignItems: "center", cursor: "pointer" }
                                    },
                                        h("span", { style: { ...cell, minWidth: 0 } },
                                            h("span", { style: { ...statsMono, fontSize: 11.5, overflowWrap: "anywhere" } }, "#" + (index + 1) + " " + session.sessionId),
                                            session.cwd ? h("span", { style: { display: "block", fontSize: 11, color: THEME.textSecondary, overflowWrap: "anywhere" } }, session.cwd) : null
                                        ),
                                        h("span", { style: { ...cell, whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" } }, session.model),
                                        h("span", { style: { ...cell, textAlign: "right", ...statsMono } },
                                            formatStatCompact(session.tokens),
                                            h("span", { style: { display: "block", height: 4, marginTop: 3, borderRadius: 999, background: THEME.track, overflow: "hidden" } },
                                                h("span", { style: { display: "block", width: Math.max(3, session.tokenPct) + "%", height: "100%", background: THEME.accent } })
                                            )
                                        ),
                                        h("span", { style: { ...cell, textAlign: "right", ...statsMono } }, formatStatSeconds(session.totalMs)),
                                        h("span", { style: { ...cell, textAlign: "center", color: statusColor, fontWeight: 600, fontSize: 11.5 } }, statusText),
                                        h("span", { style: { ...cell, textAlign: "center", color: THEME.textSecondary } }, expanded ? "▴" : "›")
                                    ),
                                    expanded ? h("div", { style: { padding: "10px 12px 12px", margin: "0 0 8px", borderRadius: 10, background: THEME.sunken, fontSize: 12, color: THEME.textSecondary, lineHeight: 1.7 } },
                                        h("div", null, t("sessionDetail", {
                                            model: formatStatSeconds(session.modelMs),
                                            tool: formatStatSeconds(session.toolMs),
                                            tools: formatStatInt(session.tools)
                                        })),
                                        h("div", null, t("sessionDetail2", {
                                            cache: session.input + session.cacheRead > 0 ? Math.round((session.cacheRead / (session.input + session.cacheRead)) * 100) : 0,
                                            first: session.firstSamples > 0 ? (session.firstMs / session.firstSamples / 1000).toFixed(1) : "0",
                                            prompts: formatStatInt(session.prompts),
                                            turns: formatStatInt(session.turns),
                                            updated: formatStatDate(session.updatedAt)
                                        }))
                                    ) : null
                                );
                            })
                        )
                    )
            );
        }

        function StatisticsSection({ t }) {
            const [range, setRange] = React.useState("7");
            const [sort, setSort] = React.useState("tokens");
            const [viewMode, setViewMode] = React.useState("bar");
            const [state, setState] = React.useState({ phase: "loading", data: null, error: "" });
            const [reloadToken, setReloadToken] = React.useState(0);

            React.useEffect(() => {
                let active = true;
                setState((current) => ({ ...current, phase: current.data ? "refreshing" : "loading", error: "" }));
                fetchCockpitStats({ range, sort, fields: "summary" })
                    .then((value) => {
                        if (active) setState({ phase: "ready", data: value, error: "" });
                    })
                    .catch((error) => {
                        if (active) setState({ phase: "error", data: null, error: error instanceof Error ? error.message : String(error) });
                    });
                return () => { active = false; };
            }, [range, sort, reloadToken]);

            const data = state.data;
            const summary = data?.summary ?? null;
            if (state.phase === "loading") {
                return h("section", { style: { maxWidth: 1100, padding: "4px 2px 32px" } },
                    h("h2", { style: { fontSize: 20, margin: "0 0 6px" } }, t("statsTitle")),
                    h("p", { style: { margin: "0 0 18px", fontSize: 13, color: THEME.textSecondary } }, t("statsSubtitle")),
                    h("div", { style: { fontSize: 13, color: THEME.textSecondary } }, t("statsLoading"))
                );
            }
            if (state.phase === "error") {
                return h("section", { style: { maxWidth: 1100, padding: "4px 2px 32px" } },
                    h("h2", { style: { fontSize: 20, margin: "0 0 6px" } }, t("statsTitle")),
                    h("div", { role: "alert", style: { fontSize: 13, color: THEME.dangerText } }, t("statsLoadFailed") + state.error),
                    h("button", { type: "button", style: { ...statsSmallButton, marginTop: 12 }, onClick: () => setReloadToken((value) => value + 1) }, t("refresh"))
                );
            }

            return h("section", { style: { maxWidth: 1100, padding: "4px 2px 32px" } },
                h("div", { style: { display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" } },
                    h("div", null,
                        h("h2", { style: { fontSize: 20, margin: "0 0 6px" } }, t("statsTitle")),
                        h("p", { style: { margin: "0 0 14px", fontSize: 13, color: THEME.textSecondary } }, t("statsSubtitle"))
                    ),
                    h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } },
                        STATS_RANGE_OPTIONS.map(([value, label]) => h("button", {
                            key: value,
                            type: "button",
                            style: range === value ? statsActiveButton : statsSmallButton,
                            onClick: () => setRange(value)
                        }, t(label))),
                        h("button", {
                            type: "button",
                            style: statsSmallButton,
                            disabled: state.phase === "refreshing",
                            onClick: () => setReloadToken((value) => value + 1)
                        }, state.phase === "refreshing" ? t("refreshing") : t("refresh"))
                    )
                ),
                h("div", { style: { ...cardBase, padding: "16px 18px", boxShadow: "none", display: "flex", gap: 18, flexWrap: "wrap" } },
                    h(StatsStat, { label: t("statTokens"), value: formatStatCompact(summary.totalTokens), hint: t("statOutput", { tokens: formatStatCompact(summary.totalOutput) }) }),
                    h(StatsStat, { label: t("statTime"), value: summary.totalTimeHours + "h", hint: t("statToolShare", { pct: summary.toolTimePct }) }),
                    h(StatsStat, { label: t("statCache"), value: summary.cacheHitPct + "%", hint: t("statCacheRead", { tokens: formatStatCompact(summary.totalCacheRead) }) }),
                    h(StatsStat, { label: t("statPrompts"), value: formatStatInt(summary.totalPrompts), hint: t("statTurns", { turns: formatStatInt(summary.totalTurns) }) }),
                    h(StatsStat, { label: t("statSessions"), value: formatStatInt(summary.validCount) + " / " + formatStatInt(summary.listed), hint: t("statWorkspaces", { count: formatStatInt(summary.workspaceCount) }) }),
                    h(StatsStat, { label: t("statTools"), value: formatStatInt(summary.totalTools), hint: t("statCallsHint", { calls: formatStatInt(summary.totalCalls) }) })
                ),
                summary.highlights?.length > 0 ? h("div", { style: { marginTop: 12, fontSize: 12.5, color: THEME.textSecondary, lineHeight: 1.7 } },
                    t("statsHighlights") + "：" + summary.highlights.join(" · ")) : null,
                h("div", { style: statsPanelStyle },
                    h("div", { style: statsPanelHead },
                        h("div", null,
                            h("h3", { style: statsTitleStyle }, t("modelBoardTitle")),
                            h("p", { style: statsSubStyle }, t("modelBoardSub", { count: summary.models.length }))
                        )
                    ),
                    h(StatsModelTable, { t, summary })
                ),
                h("div", { style: statsPanelStyle },
                    h("div", { style: statsPanelHead },
                        h("div", null,
                            h("h3", { style: statsTitleStyle }, t("rankBoardTitle")),
                            h("p", { style: statsSubStyle }, t("rankBoardSub"))
                        )
                    ),
                    h(StatsRankBoards, { t, summary })
                ),
                h(StatsTrendPanel, { t, summary, viewMode, setViewMode }),
                h(StatsDistributionPanel, { t, summary }),
                h(StatsSessionPanel, { t, summary, sort, setSort })
            );
        }

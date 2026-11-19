/**
 * Host-side statistics aggregation for dsh-cockpit.
 *
 * Ported from dsh-watcher's InsightsSettings "analytics" useMemo block (MIT;
 * see ./LICENSE). The fold itself stays in engine.mjs; this module only merges
 * already-projected views into one range-scoped summary for the Client. Cost
 * estimation and the heat-map were intentionally left out (the removal is part
 * of the reference source; cockpit never had them).
 *
 * Date bucketing runs in the host process, so local calendar days match the
 * browser when both run on the same machine (the normal DSH setup).
 */
import { mergeTools, mergeSkills, mergeWorkspaces } from "./presentation.mjs";
import { bookDayKey, calendarDayKeys, calendarSpanDays, dayKey, rangeCutoff, yesterdayKey } from "./calendar.mjs";

export const PALETTE = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ec4899", "#6366f1"];
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export const RANGES = ["1", "7", "30", "180", "all"];

const routeLabel = (route) => `${route?.provider || "未标注提供方"}/${route?.model || "未标注模型"}`;

function zero(n) {
    return Number.isFinite(n) ? n : 0;
}

/**
 * Aggregate projected views into the statistics page summary.
 * @param {Array<{sessionId:string,value:any,error:string,updatedAt:number,cwd:string|null}>} rows
 * @param {{now?:number,range?:string,sessionSort?:string,total?:number}} options
 */
export function buildAnalytics(rows, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const range = RANGES.includes(String(options.range)) ? String(options.range) : "7";
    const sessionSort = ["tokens", "time", "errors"].includes(options.sessionSort) ? options.sessionSort : "tokens";
    const listed = Number.isFinite(options.total) ? options.total : rows.length;

    const earliest = rows.reduce((min, row) => {
        if (!row.value) return min;
        const turns = Array.isArray(row.value.turns) ? row.value.turns : [];
        const firstTurn = turns.length ? Math.min(...turns.map((turn) => turn.start)) : null;
        const candidates = [row.updatedAt, firstTurn].filter((time) => Number.isFinite(time) && time > 0);
        return candidates.length ? Math.min(min, ...candidates) : min;
    }, now);
    const days = range === "all" ? calendarSpanDays(earliest, now, 365) : range === "1" ? 1 : Number(range);
    const cutoff = range === "all" ? 0 : rangeCutoff(now, days);
    const validRows = rows.filter((row) => row.value && (!row.updatedAt || row.updatedAt >= cutoff));
    const validViews = validRows.map((row) => row.value);

    let totalTokens = 0;
    let totalModelMs = 0;
    let totalToolMs = 0;
    let totalBashMs = 0;
    let totalTools = 0;
    let totalCacheRead = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheWrite = 0;
    let totalReasoning = 0;
    let totalCalls = 0;
    let totalErrors = 0;
    let totalRetries = 0;
    let totalPrompts = 0;

    for (const view of validViews) {
        totalPrompts += view.prompts ?? 0;
        totalTokens += view.totals?.tokens ?? 0;
        totalModelMs += view.totals?.modelMs ?? 0;
        totalToolMs += view.totals?.toolMs ?? 0;
        totalBashMs += view.totals?.bashMs ?? 0;
        totalTools += view.totals?.tools ?? 0;
        totalCacheRead += view.totals?.cacheRead ?? 0;
        totalInput += view.totals?.input ?? 0;
        totalOutput += view.totals?.output ?? 0;
        totalCacheWrite += view.totals?.cacheWrite ?? 0;
        totalReasoning += view.totals?.reasoning ?? 0;
        totalCalls += view.totals?.calls ?? 0;
        totalErrors += view.totals?.toolErrors ?? 0;
        totalRetries += view.totals?.retries ?? 0;
    }

    const totalWallMs = totalModelMs + totalToolMs;
    const toolTimePct = totalWallMs > 0 ? Math.round((totalToolMs / totalWallMs) * 100) : 0;
    const totalFileMs = Math.max(0, totalToolMs - totalBashMs);
    const bashPct = totalToolMs > 0 ? Math.round((totalBashMs / totalToolMs) * 100) : 0;
    const filePct = Math.max(0, 100 - bashPct);
    const totalInAll = totalInput + totalCacheRead;
    const cacheHitPct = totalInAll > 0 ? Math.round((totalCacheRead / totalInAll) * 100) : 0;

    // Model rows keep provider/model separate: same-named models from different
    // providers must never merge.
    const modelMap = new Map();
    for (const view of validViews) {
        for (const model of view.models ?? []) {
            const label = routeLabel(model);
            let row = modelMap.get(label);
            if (!row) {
                row = {
                    model: label,
                    provider: model.provider,
                    pricingModel: model.model,
                    effort: typeof model.effort === "string" ? model.effort : null,
                    calls: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
                    cacheReports: 0, reasoning: 0, modelMs: 0, firstMs: 0, firstSamples: 0, tools: 0, toolErrors: 0, retries: 0
                };
                modelMap.set(label, row);
            }
            for (const key of ["calls", "tokens", "input", "output", "cacheRead", "cacheWrite", "cacheReports", "reasoning", "modelMs", "firstMs", "firstSamples", "tools", "toolErrors", "retries"]) {
                if (typeof model[key] === "number" && Number.isFinite(model[key])) row[key] += model[key];
            }
        }
    }
    const uniqueModels = [...modelMap.values()]
        .map((row) => ({
            ...row,
            avgFirstMs: row.firstSamples > 0 ? Math.round(row.firstMs / row.firstSamples) : null,
            avgModelMs: row.calls > 0 ? Math.round(row.modelMs / row.calls) : null,
            reasoningPct: row.reasoning + row.output > 0 ? Math.round((row.reasoning / (row.reasoning + row.output)) * 100) : 0,
            cacheHitPct: row.input + row.cacheRead > 0 ? Math.round((row.cacheRead / (row.input + row.cacheRead)) * 100) : 0,
            tokensPct: totalTokens > 0 ? Math.round((row.tokens / totalTokens) * 100) : 0
        }))
        .sort((left, right) => right.tokens - left.tokens || right.calls - left.calls);

    // Stable colour per model label, ordered by token share.
    const colorMap = new Map(uniqueModels.map((row, index) => [row.model, PALETTE[index % PALETTE.length]]));
    const colorOf = (name) => colorMap.get(name) ?? PALETTE[0];

    const modelTotalTokens = Math.max(1, uniqueModels.reduce((sum, row) => sum + row.tokens, 0));
    const topModels = uniqueModels.slice(0, 4).map((row) => ({
        model: row.model,
        tokens: row.tokens,
        color: colorOf(row.model),
        pct: Math.round((row.tokens / modelTotalTokens) * 100)
    }));
    const restTokens = uniqueModels.slice(4).reduce((sum, row) => sum + row.tokens, 0);
    const donutModels = restTokens > 0 ? [...topModels, { model: "其他模型", tokens: restTokens, color: PALETTE[5], pct: Math.round((restTokens / modelTotalTokens) * 100) }] : topModels;

    // Session ordering for the "重点对话账单" list.
    const sortedSessions = [...validRows].sort((left, right) => {
        const a = left.value.totals;
        const b = right.value.totals;
        if (sessionSort === "time") {
            return ((b.modelMs ?? 0) + (b.toolMs ?? 0)) - ((a.modelMs ?? 0) + (a.toolMs ?? 0));
        }
        if (sessionSort === "errors") {
            const scoreA = (a.toolErrors ?? 0) * 100 + (a.retries ?? 0);
            const scoreB = (b.toolErrors ?? 0) * 100 + (b.retries ?? 0);
            return scoreB - scoreA || (b.tokens ?? 0) - (a.tokens ?? 0);
        }
        return (b.tokens ?? 0) - (a.tokens ?? 0);
    });
    const maxSessionTokens = Math.max(1, ...sortedSessions.map((row) => row.value?.totals?.tokens ?? 0));

    const sessions = sortedSessions.map((row) => {
        const totals = row.value.totals;
        const modelMs = zero(totals.modelMs);
        const toolMs = zero(totals.toolMs);
        const entries = (row.value.models ?? []).filter((model) => typeof model.model === "string");
        const main = [...entries].sort((left, right) => (right.tokens ?? 0) - (left.tokens ?? 0))[0];
        return {
            sessionId: row.sessionId,
            cwd: row.cwd ?? row.value.cwd ?? null,
            updatedAt: row.updatedAt || row.value.updatedAt || 0,
            model: main ? routeLabel(main) : "未标注模型",
            models: entries.length,
            tokens: zero(totals.tokens),
            input: zero(totals.input),
            output: zero(totals.output),
            cacheRead: zero(totals.cacheRead),
            cacheWrite: zero(totals.cacheWrite),
            reasoning: zero(totals.reasoning),
            modelMs,
            toolMs,
            totalMs: modelMs + toolMs,
            tools: zero(totals.tools),
            toolErrors: zero(totals.toolErrors),
            retries: zero(totals.retries),
            calls: zero(totals.calls),
            prompts: zero(row.value.prompts),
            turns: Array.isArray(row.value.turns) ? row.value.turns.length : 0,
            firstMs: zero(totals.firstMs),
            firstSamples: zero(totals.firstSamples),
            tokenPct: Math.round((zero(totals.tokens) / maxSessionTokens) * 100),
            status: zero(totals.toolErrors) > 0 ? "errors" : zero(totals.retries) > 0 ? "retry" : "ok",
            error: row.error || ""
        };
    });

    const topToolSessions = [...validRows]
        .filter((row) => (row.value?.totals?.toolMs ?? 0) > 0)
        .sort((left, right) => (right.value.totals.toolMs ?? 0) - (left.value.totals.toolMs ?? 0))
        .slice(0, 3)
        .map((row) => ({
            sessionId: row.sessionId,
            toolMs: row.value.totals.toolMs,
            bashMs: row.value.totals.bashMs ?? 0,
            model: row.value.models?.[0] ? routeLabel(row.value.models[0]) : "通用会话"
        }));

    const errorSessions = [...validRows]
        .filter((row) => (row.value?.totals?.toolErrors ?? 0) > 0 || (row.value?.totals?.retries ?? 0) > 0)
        .sort((left, right) => {
            const scoreA = (left.value.totals.toolErrors ?? 0) * 100 + (left.value.totals.retries ?? 0);
            const scoreB = (right.value.totals.toolErrors ?? 0) * 100 + (right.value.totals.retries ?? 0);
            return scoreB - scoreA;
        })
        .slice(0, 20)
        .map((row) => ({
            sessionId: row.sessionId,
            model: row.value.models?.[0] ? routeLabel(row.value.models[0]) : "通用对话",
            toolErrors: row.value.totals.toolErrors ?? 0,
            retries: row.value.totals.retries ?? 0,
            tokens: row.value.totals.tokens ?? 0,
            updatedAt: row.updatedAt || row.value.updatedAt || 0
        }));

    const toolRowsAll = mergeTools(validViews);
    const skillRowsAll = mergeSkills(validViews);
    const workspaceAll = mergeWorkspaces(validRows);
    const toolRank = toolRowsAll.slice(0, 8);
    const skillRank = skillRowsAll.slice(0, 8);
    const workspaceRank = workspaceAll.slice(0, 8);
    const toolTokensSum = toolRowsAll.reduce((sum, tool) => sum + (tool.stepTokens ?? 0), 0) || 1;
    const skillTokensSum = skillRowsAll.reduce((sum, skill) => sum + (skill.stepTokens ?? 0), 0) || 1;
    const workspaceTokensSum = workspaceAll.reduce((sum, workspace) => sum + (workspace.tokens ?? 0), 0) || 1;

    const highlights = [];
    for (const tool of toolRowsAll) {
        if ((tool.errors ?? 0) > 0) highlights.push(`「${tool.name}」报错 ${tool.errors} 次`);
    }
    const ghostSkill = skillRowsAll.find((skill) => (skill.userCalls ?? 0) === 0 && (skill.modelCalls ?? 0) > 0);
    if (ghostSkill) highlights.push(`「${ghostSkill.name}」只被模型调用，你从未手动唤起`);
    let bigInjectAvg = 0;
    let bigInjectName = "";
    for (const skill of skillRowsAll) {
        const calls = (skill.modelCalls ?? 0) + (skill.userCalls ?? 0);
        if (calls > 0 && (skill.injectedChars ?? 0) / calls > bigInjectAvg) {
            bigInjectAvg = (skill.injectedChars ?? 0) / calls;
            bigInjectName = skill.name;
        }
    }
    if (bigInjectAvg >= 1024) highlights.push(`「${bigInjectName}」每次注入约 ${Math.round(bigInjectAvg)} 字`);
    const topWorkspace = workspaceAll[0];
    const topWorkspacePct = topWorkspace ? Math.round((topWorkspace.tokens / workspaceTokensSum) * 100) : 0;
    if (topWorkspace) highlights.push(`最费项目「${topWorkspace.label}」占 ${topWorkspacePct}%`);

    // Per-tool error aggregate for the diagnostics sidebar.
    const toolErrors = toolRowsAll
        .filter((tool) => (tool.errors ?? 0) > 0)
        .sort((left, right) => (right.errors ?? 0) - (left.errors ?? 0) || (right.toolMs ?? 0) - (left.toolMs ?? 0))
        .slice(0, 20);

    // Repeated-failure findings already recorded by the engine fold.
    const findings = [];
    for (const row of validRows) {
        for (const finding of row.value.findings ?? []) {
            findings.push({
                sessionId: row.sessionId,
                id: finding.id,
                turn: finding.turn,
                title: finding.title,
                detail: finding.detail,
                kind: finding.kind
            });
        }
    }
    findings.sort((left, right) => (right.turn ?? 0) - (left.turn ?? 0));

    // Weekday distribution and per-turn tool-call shape.
    const weekdayTokens = new Array(7).fill(0);
    const weekdayTurns = new Array(7).fill(0);
    const shapeBuckets = new Array(6).fill(0);
    let scopedTurns = 0;
    for (const view of validViews) {
        for (const turn of view.turns ?? []) {
            if (!Number.isFinite(turn?.start) || turn.start < cutoff || turn.start > now + 60000) continue;
            scopedTurns++;
            const date = new Date(turn.start);
            const wd = (date.getDay() + 6) % 7;
            weekdayTokens[wd] += turn.tokens ?? 0;
            weekdayTurns[wd]++;
            const tools = turn.tools ?? 0;
            shapeBuckets[tools < 1 ? 0 : tools <= 2 ? 1 : tools <= 5 ? 2 : tools <= 10 ? 3 : tools <= 20 ? 4 : 5]++;
        }
    }
    const weekdayMax = Math.max(1, ...weekdayTokens);
    let busiest = null;
    for (let wd = 0; wd < 7; wd++) {
        if (weekdayTokens[wd] > (busiest?.tokens ?? 0)) busiest = { wd, tokens: weekdayTokens[wd], turns: weekdayTurns[wd] };
    }
    const shapeMax = Math.max(1, ...shapeBuckets);

    // Daily series: token usage is allocated by each turn's real date; the
    // model mix is split by the session's model share when a day book lacks
    // its own rows.
    const keys = calendarDayKeys(now, days);
    const byDay = new Map(keys.map((key) => [key, { models: new Map(), sessions: 0 }]));
    const addModels = (bucket, models, tokens) => {
        const total = Math.max(1, models.reduce((sum, model) => sum + (model.tokens ?? 0), 0));
        for (const model of models) {
            bucket.models.set(routeLabel(model), (bucket.models.get(routeLabel(model)) ?? 0) + tokens * ((model.tokens ?? 0) / total));
        }
    };
    for (const row of validRows) {
        const models = row.value.models?.length ? row.value.models : [{ model: "未标注", tokens: row.value.totals?.tokens ?? 0 }];
        const dayBooks = row.value?.days;
        if (Array.isArray(dayBooks) && dayBooks.length > 0) {
            const bucket = byDay.get(row.updatedAt ? dayKey(row.updatedAt) : keys[keys.length - 1]);
            if (!bucket) continue;
            bucket.sessions += 1;
            for (const dayBook of dayBooks) {
                const slotKey = bookDayKey(dayBook);
                if (!slotKey) continue;
                const dayBucket = byDay.get(slotKey);
                if (!dayBucket) continue;
                const dayModels = Array.isArray(dayBook.models) && dayBook.models.length ? dayBook.models : [{ model: "未标注", tokens: dayBook.tokens ?? 0 }];
                for (const model of dayModels) {
                    dayBucket.models.set(routeLabel(model), (dayBucket.models.get(routeLabel(model)) ?? 0) + (model.tokens ?? 0));
                }
            }
            continue;
        }
        const turns = Array.isArray(row.value.turns) ? row.value.turns : [];
        if (turns.length === 0) {
            const bucket = byDay.get(row.updatedAt ? dayKey(row.updatedAt) : keys[keys.length - 1]);
            if (!bucket) continue;
            bucket.sessions += 1;
            addModels(bucket, models, row.value.totals?.tokens ?? 0);
            continue;
        }
        const seen = new Set();
        for (const turn of turns) {
            if (!Number.isFinite(turn?.start)) continue;
            const turnBucket = byDay.get(dayKey(turn.start));
            if (!turnBucket) continue;
            if (!seen.has(dayKey(turn.start))) {
                seen.add(dayKey(turn.start));
                turnBucket.sessions += 1;
            }
            addModels(turnBucket, models, turn.tokens ?? 0);
        }
    }

    const todayStr = dayKey(now);
    const yesterdayStr = yesterdayKey(now);
    const daySeries = keys.map((key) => {
        const bucket = byDay.get(key) ?? { models: new Map(), sessions: 0 };
        const segments = [...bucket.models.entries()]
            .map(([model, tokens]) => ({ model, tokens, color: colorOf(model) }))
            .sort((left, right) => right.tokens - left.tokens);
        const total = segments.reduce((sum, segment) => sum + segment.tokens, 0);
        const date = new Date(key + "T00:00:00");
        const weekday = WEEKDAYS[date.getDay()];
        const isToday = key === todayStr;
        const isYesterday = key === yesterdayStr;
        const label = range === "7"
            ? (isToday ? "今天" : isYesterday ? "昨天" : weekday)
            : (key.endsWith("01") || key.endsWith("05") || key.endsWith("10") || key.endsWith("15") || key.endsWith("20") || key.endsWith("25") ? `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}` : "");
        return {
            key,
            label,
            weekday,
            isToday,
            isYesterday,
            total,
            sessions: bucket.sessions,
            segments: segments.map((segment) => ({
                ...segment,
                pct: total > 0 ? Math.round((segment.tokens / total) * 100) : 0
            }))
        };
    });
    const dayMax = Math.max(1, ...daySeries.map((day) => day.total));

    const activeModelMap = new Map();
    for (const day of daySeries) {
        for (const segment of day.segments) {
            activeModelMap.set(segment.model, (activeModelMap.get(segment.model) ?? 0) + segment.tokens);
        }
    }
    const activeRangeTotal = [...activeModelMap.values()].reduce((sum, tokens) => sum + tokens, 0);
    const activeRangeModels = [...activeModelMap.entries()]
        .map(([model, tokens]) => ({
            model,
            tokens,
            color: colorOf(model),
            pct: activeRangeTotal > 0 ? Math.round((tokens / activeRangeTotal) * 100) : 0
        }))
        .sort((left, right) => right.tokens - left.tokens);

    return {
        generatedAt: now,
        range,
        sessionSort,
        listed,
        validCount: validRows.length,
        days,
        cutoff,
        totalTokens,
        totalModelMs,
        totalToolMs,
        totalBashMs,
        totalFileMs,
        totalTools,
        totalCalls,
        totalInput,
        totalOutput,
        totalCacheRead,
        totalCacheWrite,
        totalReasoning,
        totalPrompts,
        totalErrors,
        totalRetries,
        totalTurns: scopedTurns,
        totalTimeHours: ((totalModelMs + totalToolMs) / 3600000).toFixed(1),
        toolTimePct,
        bashPct,
        filePct,
        cacheHitPct,
        cacheNote: cacheHitPct >= 70 ? "较高" : cacheHitPct >= 40 ? "一般" : "偏低",
        models: uniqueModels,
        donutModels,
        modelTotalTokens,
        sessions,
        maxSessionTokens,
        topToolSessions,
        errorSessions,
        toolErrors,
        findings,
        toolRank,
        skillRank,
        workspaceRank,
        toolTokensSum,
        skillTokensSum,
        workspaceTokensSum,
        highlights,
        topWorkspace: topWorkspace ?? null,
        topWorkspacePct,
        workspaceCount: workspaceAll.length,
        weekdayTokens,
        weekdayTurns,
        weekdayMax,
        busiest,
        scopedTurns,
        shapeBuckets,
        shapeMax,
        daySeries,
        dayMax,
        activeRangeModels
    };
}

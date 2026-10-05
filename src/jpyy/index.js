import { genSign, SIGN_KEY } from "./sign.js";
import { extractVodItems, extractMeta } from "./rsc.js";
import { resolveTmdbMetadata } from "./tmdb-resolver.js";

var PROVIDER_NAME = "jpyy";
var BASE_URL = "https://0996zp.com";
var CLIENT_TYPE = 1;
var DEVICE_ID = "39cb57bc-f77b-42c8-84e8-25fe857385d1";
var MIN_VOD_SCORE = 0.5;

// 内存缓存
var rscCache = new Map();
var RSC_CACHE_TTL = 5 * 60 * 1000;

// ==========================================
// 输入校验
// ==========================================
function positiveInteger(value, fieldName) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) {
        throw new Error(`${fieldName} must be a positive integer`);
    }
    return number;
}

function normalizeInput(tmdbId, mediaType, season, episode) {
    const normalizedId = String(tmdbId ?? "").trim();
    const normalizedType = String(mediaType ?? "").trim().toLowerCase();

    if (!normalizedId) throw new Error("tmdbId is required");
    if (normalizedType !== "movie" && normalizedType !== "tv") {
        throw new Error('mediaType must be either "movie" or "tv"');
    }
    if (normalizedType === "movie") {
        return { tmdbId: normalizedId, mediaType: normalizedType, season: null, episode: null };
    }
    return {
        tmdbId: normalizedId,
        mediaType: normalizedType,
        season: positiveInteger(season, "season"),
        episode: positiveInteger(episode, "episode")
    };
}

function encodeQuery(params) {
    return Object.keys(params)
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
        .join("&");
}

// ==========================================
// 网络请求（带内存缓存）
// ==========================================
async function fetchRsc(path) {
    const cached = rscCache.get(path);
    if (cached && Date.now() - cached.time < RSC_CACHE_TTL) {
        return cached.body;
    }
    const response = await fetch(`${BASE_URL}${path}`, {
        method: "GET",
        headers: {
            Accept: "*/*",
            RSC: "1",
            "Next-Url": path,
            Referer: `${BASE_URL}${path}`,
            "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"
        }
    });
    const body = await response.text();
    if (!response.ok) {
        throw new Error(`RSC 请求失败 HTTP ${response.status} @ ${path}`);
    }
    rscCache.set(path, { time: Date.now(), body });
    return body;
}

// ==========================================
// 匹配辅助
// ==========================================
function getBroadTypeId(item) {
    return Number(item.typeId1);
}

function normalizeName(value) {
    return String(value ?? "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "");
}

function similarity(s1, s2) {
    if (!s1 || !s2) return 0;
    s1 = String(s1).toLowerCase().trim();
    s2 = String(s2).toLowerCase().trim();
    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.85;

    let [a, b] = [s1, s2];
    if (a.length < b.length) [a, b] = [b, a];
    const lenA = a.length;
    const lenB = b.length;
    if (lenA === 0 || lenB === 0) return 0;

    let prev = new Array(lenB + 1);
    let curr = new Array(lenB + 1);
    for (let j = 0; j <= lenB; j++) prev[j] = j;

    for (let i = 1; i <= lenA; i++) {
        curr[0] = i;
        for (let j = 1; j <= lenB; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return 1 - prev[lenB] / Math.max(lenA, lenB);
}

function hasSeasonMarker(item, metadata) {
    const rawName = String(item.vodName ?? "").normalize("NFKC").toLowerCase();
    const normalizedName = normalizeName(rawName);
    const labels = Array.isArray(metadata.seasonLabels) ? metadata.seasonLabels : [];

    const normalizedLabelMatch = labels.some((label) => {
        const normalizedLabel = normalizeName(label);
        return normalizedLabel.length >= 2 && normalizedName.includes(normalizedLabel);
    });
    if (normalizedLabelMatch) return true;

    const season = metadata.season;
    if (!Number.isInteger(season)) return false;

    const escapedSeason = String(season).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const chineseSeasonPattern = new RegExp(`第\\s*0*${escapedSeason}\\s*季(?![0-9])`, "i");
    const englishSeasonPattern = new RegExp(`(?:season)\\s*0*${escapedSeason}(?![0-9])`, "i");
    const shortSeasonPattern = new RegExp(`(?:^|[^a-z0-9])s\\s*0*${escapedSeason}(?![0-9])`, "i");

    return (
        chineseSeasonPattern.test(rawName) ||
        englishSeasonPattern.test(rawName) ||
        shortSeasonPattern.test(rawName)
    );
}

function uniqueValues(values) {
    const result = [];
    const seen = new Set();
    for (const value of values) {
        if (typeof value !== "string") continue;
        const normalized = value.normalize("NFKC").toLowerCase().trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(value);
    }
    return result;
}

function scoreVod(item, metadata) {
    const candidateTitles = uniqueValues([
        metadata.title,
        metadata.originalTitle,
        ...(Array.isArray(metadata.aliases) ? metadata.aliases : [])
    ]);
    if (candidateTitles.length === 0) return 0;

    let maxSim = 0;
    for (const t of candidateTitles) {
        const sim = similarity(t, item.vodName);
        if (sim > maxSim) maxSim = sim;
    }
    if (maxSim < 0.3) return 0;

    let score = maxSim;

    const rawYear = String(item.vodYear ?? "").trim();
    const itemYear = Number.parseInt(rawYear.slice(0, 4), 10);
    if (Number.isFinite(itemYear)) {
        const expectedYears = [metadata.seasonYear, metadata.year, metadata.seriesYear].filter((v) =>
            Number.isInteger(v)
        );
        if (expectedYears.includes(itemYear)) {
            score += 0.3;
        } else if (expectedYears.some((y) => Math.abs(y - itemYear) <= 1)) {
            score += 0.15;
        } else if (
            expectedYears.length > 0 &&
            expectedYears.every((y) => Math.abs(y - itemYear) > 3)
        ) {
            score -= 0.3;
        }
    }

    for (const t of candidateTitles) {
        if (item.vodName === t) {
            score += 0.5;
            break;
        }
        if (item.vodName.includes(t) || t.includes(item.vodName)) {
            score += 0.2;
            break;
        }
    }

    if (hasSeasonMarker(item, metadata)) {
        score += 0.3;
    }

    return score;
}

function pickVod(items, input, metadata) {
    const candidates = items.filter((item) => {
        const typeId1 = getBroadTypeId(item);
        if (input.mediaType === "movie") return typeId1 === 1;
        return [2, 3, 4, 88].includes(typeId1);
    });

    const ranked = candidates
        .map((item) => ({ item, score: scoreVod(item, metadata) }))
        .filter((entry) => entry.score >= MIN_VOD_SCORE)
        .sort((a, b) => b.score - a.score);

    return ranked[0]?.item ?? null;
}

// ==========================================
// 站内搜索与详情
// ==========================================
async function searchVod(input, metadata) {
    const queries = Array.isArray(metadata.searchQueries) ? metadata.searchQueries : [];
    if (queries.length === 0) return [];

    const items = [];
    const seen = new Set();
    let successCount = 0;
    let lastError = null;

    for (const query of queries) {
        try {
            const body = await fetchRsc(`/vod/search/${encodeURIComponent(query)}`);
            successCount += 1;
            const results = extractVodItems(body);
            for (const item of results) {
                const key = String(item.vodId);
                if (seen.has(key)) continue;
                seen.add(key);
                items.push(item);
            }
        } catch (error) {
            lastError = error;
        }
    }

    if (successCount === 0 && lastError) throw lastError;
    return items;
}

async function getDetail(vodId) {
    const path = `/detail/${encodeURIComponent(String(vodId))}`;
    const body = await fetchRsc(path);
    const detail = extractMeta(body);
    if (!detail) {
        throw new Error(`详情解析失败 vodId=${vodId}`);
    }
    return detail;
}

function selectEpisodes(detail, input, metadata) {
    const list = Array.isArray(detail.episodeList) ? detail.episodeList : [];
    if (input.mediaType === "movie") return list;
    if (metadata.episodeNid != null) return [{ nid: metadata.episodeNid }];

    const wanted = String(input.episode);
    const byName = list.find((item) => String(item.name).trim() === wanted);
    if (byName) return [byName];

    const bySort = list.find((item) => Number(item.sort) === input.episode);
    if (bySort) return [bySort];

    const byIndex = list[input.episode - 1];
    if (byIndex) return [byIndex];

    return [];
}

// ==========================================
// 流地址获取
// ==========================================
async function fetchEpisodeStreams(vodId, nid) {
    const params = {
        clientType: CLIENT_TYPE,
        id: String(vodId),
        nid: String(nid)
    };
    const t = Date.now();
    const sign = genSign({ method: "GET", params, t });
    const path = `/api/mw-movie/anonymous/v2/video/episode/url?${encodeQuery(params)}`;

    const response = await fetch(`${BASE_URL}${path}`, {
        method: "GET",
        headers: {
            Accept: "application/json, text/plain, */*",
            "client-type": String(CLIENT_TYPE),
            deviceId: DEVICE_ID,
            sign,
            t: String(t),
            authorization: "",
            Referer: `${BASE_URL}/vod/play/${vodId}/sid/${nid}`
        }
    });

    const body = await response.text();
    if (!response.ok) {
        throw new Error(`流请求失败 HTTP ${response.status} nid=${nid}`);
    }

    let json;
    try {
        json = JSON.parse(body);
    } catch (e) {
        throw new Error(`流响应非 JSON nid=${nid}`);
    }

    if (!json || json.code !== 200) {
        throw new Error(`流 API 错误: ${json?.msg || "unknown"} nid=${nid}`);
    }

    const list = json.data && Array.isArray(json.data.list) ? json.data.list : [];
    return list;
}

function toStream(item, { vodName, tmdbId, vodId, nid } = {}) {
    if (!item || !item.url) return null;
    const rawUrl = String(item.url).trim();
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    } catch (e) {
        return null;
    }

    const resolution = Number(item.resolution);
    const quality = Number.isFinite(resolution) ? `${Math.round(resolution)}p` : "unknown";
    const resolutionName = String(item.resolutionName || "").trim();
    const title = resolutionName ? `${resolutionName} ${quality}` : `JPYY ${quality}`;

    return {
        name: vodName || PROVIDER_NAME,
        title,
        url: rawUrl,
        quality
    };
}

// ==========================================
// 主入口
// ==========================================
async function getStreams(tmdbId, mediaType, season = null, episode = null) {
    // step 用于在出错时定位卡在哪一步
    let step = "init";

    try {
        step = "normalizeInput";
        const input = normalizeInput(tmdbId, mediaType, season, episode);

        step = "resolveTmdbMetadata";
        const metadata = await resolveTmdbMetadata(input);
        if (!metadata || !metadata.title) {
            throw new Error("TMDB 元数据不完整");
        }

        step = "searchVod";
        const items = await searchVod(input, metadata);

        step = "pickVod";
        const vod = pickVod(items, input, metadata);
        if (!vod) {
            // 找不到匹配：返回空数组，不是错误
            return [];
        }

        step = "getDetail";
        const detail = await getDetail(vod.vodId);
        const vodName = detail.vodName || detail.name || metadata.title || "";

        step = "selectEpisodes";
        const episodes = selectEpisodes(detail, input, metadata);
        if (episodes.length === 0) {
            throw new Error(`未匹配到第 ${episode} 集`);
        }

        step = "fetchEpisodeStreams";
        const streams = [];
        const seen = new Set();
        let lastError = null;

        for (const episodeItem of episodes) {
            if (episodeItem.nid == null) continue;
            try {
                const items = await fetchEpisodeStreams(vod.vodId, episodeItem.nid);
                for (const item of items) {
                    const stream = toStream(item, {
                        vodName,
                        tmdbId: input.tmdbId,
                        vodId: vod.vodId,
                        nid: episodeItem.nid
                    });
                    if (!stream) continue;
                    if (seen.has(stream.url)) continue;
                    seen.add(stream.url);
                    streams.push(stream);
                }
            } catch (error) {
                lastError = error;
            }
        }

        if (streams.length === 0) {
            if (lastError) throw lastError;
            throw new Error("未获取到任何流地址");
        }

        return streams;
    } catch (e) {
        // 只在出错时返回一条错误条目，把出错步骤和原因写进 title
        return [
            {
                name: PROVIDER_NAME,
                title: `[${step}] ${e.message}`,
                url: "https://test.com/error",
                quality: "ERROR"
            }
        ];
    }
}

export { getStreams };
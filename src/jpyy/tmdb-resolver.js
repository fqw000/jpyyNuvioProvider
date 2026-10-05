// ==========================================
// TMDB 元数据解析器
// 功能：根据 TMDB ID 获取标题、别名、年份、季数等信息
// ==========================================

var TMDB_API_KEY = "e5c3c7269a147fee368c3649ddd98875";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var CACHE_TTL = 6 * 60 * 60 * 1000;

var metadataCache = new Map();

// ==========================================
// 基础工具
// ==========================================

function checkApiKey() {
    if (!TMDB_API_KEY || TMDB_API_KEY === "3fa903159384423972387659a870b62f") {
        throw new Error("TMDB_API_KEY 未配置");
    }
}

function uniqueTitles(values) {
    const result = [];
    const seen = new Set();

    function visit(value) {
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (typeof value !== "string") return;
        const title = value.trim();
        if (!title) return;

        const key = title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
        if (seen.has(key)) return;
        seen.add(key);
        result.push(title);
    }

    for (const value of values) visit(value);
    return result;
}

function getYear(value) {
    const match = /^(\d{4})/.exec(String(value ?? ""));
    return match ? Number(match[1]) : null;
}

function chineseNumber(value) {
    const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    const number = Number(value);

    if (number >= 0 && number <= 10) return digits[number];
    if (number > 10 && number < 20) {
        return `十${number % 10 ? digits[number % 10] : ""}`;
    }
    if (number >= 20 && number < 100) {
        const tens = digits[Math.floor(number / 10)];
        const ones = number % 10 ? digits[number % 10] : "";
        return `${tens}十${ones}`;
    }
    return String(number);
}

function getTitlePriority(title) {
    if (!title) return -1;
    const chineseCount = (title.match(/[\u4e00-\u9fa5]/g) || []).length;
    const totalLength = title.length;
    if (/^[\u4e00-\u9fa5]+$/.test(title)) return 3;
    if (chineseCount / totalLength > 0.5) return 2;
    return 0;
}

// ==========================================
// TMDB 请求
// ==========================================

async function tmdbGet(path, params = {}) {
    checkApiKey();

    const url = new URL(`${TMDB_BASE_URL}/${path}`);
    url.searchParams.set("api_key", TMDB_API_KEY);

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
        }
    }

    let response;
    try {
        response = await fetch(url.toString(), {
            method: "GET",
            headers: { Accept: "application/json" }
        });
    } catch (netError) {
        throw new Error(`TMDB 网络异常 @ ${path}: ${netError.message}`);
    }

    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(`TMDB 返回非 JSON @ ${path} HTTP ${response.status}`);
    }

    if (!response.ok) {
        const message = data?.status_message || data?.message || response.statusText;
        throw new Error(`TMDB 请求失败 @ ${path} HTTP ${response.status}: ${message}`);
    }

    return data;
}

async function optionalTmdbGet(path, params = {}) {
    try {
        return await tmdbGet(path, params);
    } catch (e) {
        return null;
    }
}

// ==========================================
// 别名收集
// ==========================================

function extractExtraTitles(alternative, translations) {
    const alternativeItems = alternative?.titles ?? alternative?.results ?? [];
    const translationItems = translations?.data ?? [];

    const raw = uniqueTitles([
        ...alternativeItems.map(
            (item) =>
                item.title ??
                item.name ??
                item.original_title ??
                item.original_name
        ),
        ...translationItems.map((item) => item.title ?? item.name)
    ]);

    return raw.sort((a, b) => getTitlePriority(b) - getTitlePriority(a));
}

// ==========================================
// 搜索查询生成
// ==========================================

function buildMovieSearchQueries(titles, year) {
    const baseQueries = titles.slice(0, 3);
    const yearQueries = year
        ? titles.slice(0, 1).map((title) => `${title} ${year}`)
        : [];
    return uniqueTitles([...baseQueries, ...yearQueries]).slice(0, 5);
}

function buildTvSearchQueries(titles, season, seasonName, seasonYear, seriesYear) {
    const baseQueries = titles.slice(0, 3);

    const seasonLabels = uniqueTitles([
        seasonName,
        `第${season}季`,
        `第${chineseNumber(season)}季`,
        `Season ${season}`
    ]);

    const seasonQueries = [];
    for (const title of titles.slice(0, 2)) {
        for (const label of seasonLabels.slice(0, 1)) {
            seasonQueries.push(`${title} ${label}`);
        }
    }

    const queryYear = seasonYear != null ? seasonYear : seriesYear;
    const yearQueries = queryYear
        ? titles.slice(0, 1).map((title) => `${title} ${queryYear}`)
        : [];

    return uniqueTitles([
        ...baseQueries,
        ...seasonQueries.slice(0, 2),
        ...yearQueries
    ]).slice(0, 6);
}

// ==========================================
// 缓存
// ==========================================

function readCache(key) {
    const cached = metadataCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.time >= CACHE_TTL) {
        metadataCache.delete(key);
        return null;
    }
    return cached.value;
}

function writeCache(key, value) {
    metadataCache.set(key, {
        time: Date.now(),
        value
    });
}

// ==========================================
// 主入口
// ==========================================

async function resolveTmdbMetadata({ tmdbId, mediaType, season = null }) {
    const id = String(tmdbId ?? "").trim();
    const type = String(mediaType ?? "").trim().toLowerCase();

    if (!/^\d+$/.test(id)) {
        throw new Error(`无效 TMDB ID: ${tmdbId}`);
    }
    if (type !== "movie" && type !== "tv") {
        throw new Error(`不支持的类型: ${mediaType}`);
    }
    if (type === "tv" && (!Number.isInteger(season) || season < 0)) {
        throw new Error(`无效季数: ${season}`);
    }

    const cacheKey = `${type}:${id}:${season ?? "-"}`;
    const cached = readCache(cacheKey);
    if (cached) return cached;

    const typePath = type === "movie" ? "movie" : "tv";
    const detail = await tmdbGet(`${typePath}/${encodeURIComponent(id)}`, {
        language: "zh-CN"
    });

    // ========== 电影 ==========
    if (type === "movie") {
        const [alternative, translations] = await Promise.all([
            optionalTmdbGet(`movie/${encodeURIComponent(id)}/alternative_names`),
            optionalTmdbGet(`movie/${encodeURIComponent(id)}/translations`)
        ]);

        const extraTitles = extractExtraTitles(alternative, translations);
        const titles = uniqueTitles([
            detail.title,
            detail.original_title,
            ...extraTitles
        ]);

        if (titles.length === 0) {
            throw new Error(`TMDB 电影无可用标题: ${id}`);
        }

        const year = getYear(detail.release_date);

        const result = {
            tmdbId: id,
            mediaType: "movie",
            title: titles[0],
            originalTitle: detail.original_title ?? null,
            aliases: titles.slice(1),
            year,
            seriesYear: null,
            seasonYear: null,
            season: null,
            seasonLabels: [],
            expectedEpisodeCount: null,
            searchQueries: buildMovieSearchQueries(titles, year)
        };

        writeCache(cacheKey, result);
        return result;
    }

    // ========== 电视剧 ==========
    const [alternative, translations, seasonDetail] = await Promise.all([
        optionalTmdbGet(`tv/${encodeURIComponent(id)}/alternative_names`),
        optionalTmdbGet(`tv/${encodeURIComponent(id)}/translations`),
        optionalTmdbGet(
            `tv/${encodeURIComponent(id)}/season/${encodeURIComponent(season)}`,
            { language: "zh-CN" }
        )
    ]);

    const extraTitles = extractExtraTitles(alternative, translations);
    const titles = uniqueTitles([
        detail.name,
        detail.original_name,
        ...extraTitles
    ]);

    if (titles.length === 0) {
        throw new Error(`TMDB 剧集无可用标题: ${id}`);
    }

    const seriesYear = getYear(detail.first_air_date);
    const seasonYear = getYear(seasonDetail?.air_date);
    const expectedEpisodeCount = Array.isArray(seasonDetail?.episodes)
        ? seasonDetail.episodes.length
        : null;

    const result = {
        tmdbId: id,
        mediaType: "tv",
        title: titles[0],
        originalTitle: detail.original_name ?? null,
        aliases: titles.slice(1),
        year: seasonYear ?? seriesYear,
        seriesYear,
        seasonYear,
        season,
        seasonName: seasonDetail?.name ?? null,
        seasonLabels: uniqueTitles([
            seasonDetail?.name,
            `第${season}季`,
            `第${chineseNumber(season)}季`,
            `Season ${season}`
        ]),
        expectedEpisodeCount,
        searchQueries: buildTvSearchQueries(
            titles,
            season,
            seasonDetail?.name,
            seasonYear,
            seriesYear
        )
    };

    writeCache(cacheKey, result);
    return result;
}

export { resolveTmdbMetadata };
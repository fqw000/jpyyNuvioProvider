/**
 * jpyy - Built from src/jpyy/
 * Generated: 2026-10-05T13:41:37.081Z
 */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/jpyy/index.js
var jpyy_exports = {};
__export(jpyy_exports, {
  getStreams: () => getStreams
});
module.exports = __toCommonJS(jpyy_exports);

// src/jpyy/sign.js
var import_crypto_js = __toESM(require("crypto-js"));
var SIGN_KEY = "cb808529bae6b6be45ecfab29a4889bc";
function genSign({
  method = "GET",
  params = {},
  t = Date.now(),
  signKey = SIGN_KEY
} = {}) {
  const upperMethod = String(method).toUpperCase();
  let payload = "";
  if (upperMethod === "GET") {
    const keys = Object.keys(params).sort();
    payload = keys.length ? keys.map((key) => `${key}=${params[key]}`).join("&") : "";
  } else {
    payload = Object.keys(params).length ? JSON.stringify(params) : "";
  }
  const input = payload ? `${payload}&key=${signKey}&t=${t}` : `key=${signKey}&t=${t}`;
  const md5 = import_crypto_js.default.MD5(input).toString();
  return import_crypto_js.default.SHA1(md5).toString();
}

// src/jpyy/rsc.js
function parseRscRecords(body) {
  const values = [];
  let current = null;
  function flush() {
    if (!current) {
      return;
    }
    try {
      values.push(JSON.parse(current.raw.trim()));
    } catch (e) {
    }
    current = null;
  }
  for (const line of String(body).split(/\r?\n/)) {
    const match = line.match(/^([0-9a-f]+):\s?(.*)$/i);
    if (match) {
      flush();
      current = {
        raw: match[2]
      };
    } else if (current) {
      current.raw += `
${line}`;
    }
  }
  flush();
  if (values.length === 0) {
    try {
      values.push(JSON.parse(body));
    } catch (e) {
    }
  }
  return values;
}
function walk(value, visitor) {
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, visitor);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  visitor(value);
  for (const key of Object.keys(value)) {
    walk(value[key], visitor);
  }
}
function isVodItem(value) {
  return value && typeof value === "object" && value.vodId !== void 0 && value.vodId !== null;
}
function extractVodItems(body) {
  const records = parseRscRecords(body);
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const record of records) {
    walk(record, (node) => {
      if (!Array.isArray(node.list)) {
        return;
      }
      for (const item of node.list) {
        if (!isVodItem(item)) {
          continue;
        }
        const key = String(item.vodId);
        if (!seen.has(key)) {
          seen.add(key);
          result.push(item);
        }
      }
    });
  }
  return result;
}
function extractMeta(body) {
  const records = parseRscRecords(body);
  for (const record of records) {
    let matched = null;
    walk(record, (node) => {
      if (!matched && node && node.vodId !== void 0 && node.vodId !== null && Array.isArray(node.episodeList)) {
        matched = node;
      }
    });
    if (matched) {
      return matched;
    }
  }
  return null;
}

// src/jpyy/tmdb-resolver.js
var TMDB_API_KEY = "e5c3c7269a147fee368c3649ddd98875";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var CACHE_TTL = 6 * 60 * 60 * 1e3;
var metadataCache = /* @__PURE__ */ new Map();
function checkApiKey() {
  if (!TMDB_API_KEY || TMDB_API_KEY === "3fa903159384423972387659a870b62f") {
    throw new Error("TMDB_API_KEY \u672A\u914D\u7F6E");
  }
}
function uniqueTitles(values) {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value)
        visit(item);
      return;
    }
    if (typeof value !== "string")
      return;
    const title = value.trim();
    if (!title)
      return;
    const key = title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key))
      return;
    seen.add(key);
    result.push(title);
  }
  for (const value of values)
    visit(value);
  return result;
}
function getYear(value) {
  const match = /^(\d{4})/.exec(String(value != null ? value : ""));
  return match ? Number(match[1]) : null;
}
function chineseNumber(value) {
  const digits = ["\u96F6", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u4E03", "\u516B", "\u4E5D"];
  const number = Number(value);
  if (number >= 0 && number <= 10)
    return digits[number];
  if (number > 10 && number < 20) {
    return `\u5341${number % 10 ? digits[number % 10] : ""}`;
  }
  if (number >= 20 && number < 100) {
    const tens = digits[Math.floor(number / 10)];
    const ones = number % 10 ? digits[number % 10] : "";
    return `${tens}\u5341${ones}`;
  }
  return String(number);
}
function getTitlePriority(title) {
  if (!title)
    return -1;
  const chineseCount = (title.match(/[\u4e00-\u9fa5]/g) || []).length;
  const totalLength = title.length;
  if (/^[\u4e00-\u9fa5]+$/.test(title))
    return 3;
  if (chineseCount / totalLength > 0.5)
    return 2;
  return 0;
}
function tmdbGet(_0) {
  return __async(this, arguments, function* (path, params = {}) {
    checkApiKey();
    const url = new URL(`${TMDB_BASE_URL}/${path}`);
    url.searchParams.set("api_key", TMDB_API_KEY);
    for (const [key, value] of Object.entries(params)) {
      if (value !== void 0 && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    let response;
    try {
      response = yield fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" }
      });
    } catch (netError) {
      throw new Error(`TMDB \u7F51\u7EDC\u5F02\u5E38 @ ${path}: ${netError.message}`);
    }
    const text = yield response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`TMDB \u8FD4\u56DE\u975E JSON @ ${path} HTTP ${response.status}`);
    }
    if (!response.ok) {
      const message = (data == null ? void 0 : data.status_message) || (data == null ? void 0 : data.message) || response.statusText;
      throw new Error(`TMDB \u8BF7\u6C42\u5931\u8D25 @ ${path} HTTP ${response.status}: ${message}`);
    }
    return data;
  });
}
function optionalTmdbGet(_0) {
  return __async(this, arguments, function* (path, params = {}) {
    try {
      return yield tmdbGet(path, params);
    } catch (e) {
      return null;
    }
  });
}
function extractExtraTitles(alternative, translations) {
  var _a, _b, _c;
  const alternativeItems = (_b = (_a = alternative == null ? void 0 : alternative.titles) != null ? _a : alternative == null ? void 0 : alternative.results) != null ? _b : [];
  const translationItems = (_c = translations == null ? void 0 : translations.data) != null ? _c : [];
  const raw = uniqueTitles([
    ...alternativeItems.map(
      (item) => {
        var _a2, _b2, _c2;
        return (_c2 = (_b2 = (_a2 = item.title) != null ? _a2 : item.name) != null ? _b2 : item.original_title) != null ? _c2 : item.original_name;
      }
    ),
    ...translationItems.map((item) => {
      var _a2;
      return (_a2 = item.title) != null ? _a2 : item.name;
    })
  ]);
  return raw.sort((a, b) => getTitlePriority(b) - getTitlePriority(a));
}
function buildMovieSearchQueries(titles, year) {
  const baseQueries = titles.slice(0, 3);
  const yearQueries = year ? titles.slice(0, 1).map((title) => `${title} ${year}`) : [];
  return uniqueTitles([...baseQueries, ...yearQueries]).slice(0, 5);
}
function buildTvSearchQueries(titles, season, seasonName, seasonYear, seriesYear) {
  const baseQueries = titles.slice(0, 3);
  const seasonLabels = uniqueTitles([
    seasonName,
    `\u7B2C${season}\u5B63`,
    `\u7B2C${chineseNumber(season)}\u5B63`,
    `Season ${season}`
  ]);
  const seasonQueries = [];
  for (const title of titles.slice(0, 2)) {
    for (const label of seasonLabels.slice(0, 1)) {
      seasonQueries.push(`${title} ${label}`);
    }
  }
  const queryYear = seasonYear != null ? seasonYear : seriesYear;
  const yearQueries = queryYear ? titles.slice(0, 1).map((title) => `${title} ${queryYear}`) : [];
  return uniqueTitles([
    ...baseQueries,
    ...seasonQueries.slice(0, 2),
    ...yearQueries
  ]).slice(0, 6);
}
function readCache(key) {
  const cached = metadataCache.get(key);
  if (!cached)
    return null;
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
function resolveTmdbMetadata(_0) {
  return __async(this, arguments, function* ({ tmdbId, mediaType, season = null }) {
    var _a, _b, _c;
    const id = String(tmdbId != null ? tmdbId : "").trim();
    const type = String(mediaType != null ? mediaType : "").trim().toLowerCase();
    if (!/^\d+$/.test(id)) {
      throw new Error(`\u65E0\u6548 TMDB ID: ${tmdbId}`);
    }
    if (type !== "movie" && type !== "tv") {
      throw new Error(`\u4E0D\u652F\u6301\u7684\u7C7B\u578B: ${mediaType}`);
    }
    if (type === "tv" && (!Number.isInteger(season) || season < 0)) {
      throw new Error(`\u65E0\u6548\u5B63\u6570: ${season}`);
    }
    const cacheKey = `${type}:${id}:${season != null ? season : "-"}`;
    const cached = readCache(cacheKey);
    if (cached)
      return cached;
    const typePath = type === "movie" ? "movie" : "tv";
    const detail = yield tmdbGet(`${typePath}/${encodeURIComponent(id)}`, {
      language: "zh-CN"
    });
    if (type === "movie") {
      const [alternative2, translations2] = yield Promise.all([
        optionalTmdbGet(`movie/${encodeURIComponent(id)}/alternative_names`),
        optionalTmdbGet(`movie/${encodeURIComponent(id)}/translations`)
      ]);
      const extraTitles2 = extractExtraTitles(alternative2, translations2);
      const titles2 = uniqueTitles([
        detail.title,
        detail.original_title,
        ...extraTitles2
      ]);
      if (titles2.length === 0) {
        throw new Error(`TMDB \u7535\u5F71\u65E0\u53EF\u7528\u6807\u9898: ${id}`);
      }
      const year = getYear(detail.release_date);
      const result2 = {
        tmdbId: id,
        mediaType: "movie",
        title: titles2[0],
        originalTitle: (_a = detail.original_title) != null ? _a : null,
        aliases: titles2.slice(1),
        year,
        seriesYear: null,
        seasonYear: null,
        season: null,
        seasonLabels: [],
        expectedEpisodeCount: null,
        searchQueries: buildMovieSearchQueries(titles2, year)
      };
      writeCache(cacheKey, result2);
      return result2;
    }
    const [alternative, translations, seasonDetail] = yield Promise.all([
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
      throw new Error(`TMDB \u5267\u96C6\u65E0\u53EF\u7528\u6807\u9898: ${id}`);
    }
    const seriesYear = getYear(detail.first_air_date);
    const seasonYear = getYear(seasonDetail == null ? void 0 : seasonDetail.air_date);
    const expectedEpisodeCount = Array.isArray(seasonDetail == null ? void 0 : seasonDetail.episodes) ? seasonDetail.episodes.length : null;
    const result = {
      tmdbId: id,
      mediaType: "tv",
      title: titles[0],
      originalTitle: (_b = detail.original_name) != null ? _b : null,
      aliases: titles.slice(1),
      year: seasonYear != null ? seasonYear : seriesYear,
      seriesYear,
      seasonYear,
      season,
      seasonName: (_c = seasonDetail == null ? void 0 : seasonDetail.name) != null ? _c : null,
      seasonLabels: uniqueTitles([
        seasonDetail == null ? void 0 : seasonDetail.name,
        `\u7B2C${season}\u5B63`,
        `\u7B2C${chineseNumber(season)}\u5B63`,
        `Season ${season}`
      ]),
      expectedEpisodeCount,
      searchQueries: buildTvSearchQueries(
        titles,
        season,
        seasonDetail == null ? void 0 : seasonDetail.name,
        seasonYear,
        seriesYear
      )
    };
    writeCache(cacheKey, result);
    return result;
  });
}

// src/jpyy/index.js
var PROVIDER_NAME = "jpyy";
var BASE_URL = "https://0996zp.com";
var CLIENT_TYPE = 1;
var DEVICE_ID = "39cb57bc-f77b-42c8-84e8-25fe857385d1";
var MIN_VOD_SCORE = 0.5;
var rscCache = /* @__PURE__ */ new Map();
var RSC_CACHE_TTL = 5 * 60 * 1e3;
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return number;
}
function normalizeInput(tmdbId, mediaType, season, episode) {
  const normalizedId = String(tmdbId != null ? tmdbId : "").trim();
  const normalizedType = String(mediaType != null ? mediaType : "").trim().toLowerCase();
  if (!normalizedId)
    throw new Error("tmdbId is required");
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
  return Object.keys(params).map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`).join("&");
}
function fetchRsc(path) {
  return __async(this, null, function* () {
    const cached = rscCache.get(path);
    if (cached && Date.now() - cached.time < RSC_CACHE_TTL) {
      return cached.body;
    }
    const response = yield fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: {
        Accept: "*/*",
        RSC: "1",
        "Next-Url": path,
        Referer: `${BASE_URL}${path}`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"
      }
    });
    const body = yield response.text();
    if (!response.ok) {
      throw new Error(`RSC \u8BF7\u6C42\u5931\u8D25 HTTP ${response.status} @ ${path}`);
    }
    rscCache.set(path, { time: Date.now(), body });
    return body;
  });
}
function getBroadTypeId(item) {
  return Number(item.typeId1);
}
function normalizeName(value) {
  return String(value != null ? value : "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
function similarity(s1, s2) {
  if (!s1 || !s2)
    return 0;
  s1 = String(s1).toLowerCase().trim();
  s2 = String(s2).toLowerCase().trim();
  if (s1 === s2)
    return 1;
  if (s1.includes(s2) || s2.includes(s1))
    return 0.85;
  let [a, b] = [s1, s2];
  if (a.length < b.length)
    [a, b] = [b, a];
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0 || lenB === 0)
    return 0;
  let prev = new Array(lenB + 1);
  let curr = new Array(lenB + 1);
  for (let j = 0; j <= lenB; j++)
    prev[j] = j;
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
  var _a;
  const rawName = String((_a = item.vodName) != null ? _a : "").normalize("NFKC").toLowerCase();
  const normalizedName = normalizeName(rawName);
  const labels = Array.isArray(metadata.seasonLabels) ? metadata.seasonLabels : [];
  const normalizedLabelMatch = labels.some((label) => {
    const normalizedLabel = normalizeName(label);
    return normalizedLabel.length >= 2 && normalizedName.includes(normalizedLabel);
  });
  if (normalizedLabelMatch)
    return true;
  const season = metadata.season;
  if (!Number.isInteger(season))
    return false;
  const escapedSeason = String(season).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const chineseSeasonPattern = new RegExp(`\u7B2C\\s*0*${escapedSeason}\\s*\u5B63(?![0-9])`, "i");
  const englishSeasonPattern = new RegExp(`(?:season)\\s*0*${escapedSeason}(?![0-9])`, "i");
  const shortSeasonPattern = new RegExp(`(?:^|[^a-z0-9])s\\s*0*${escapedSeason}(?![0-9])`, "i");
  return chineseSeasonPattern.test(rawName) || englishSeasonPattern.test(rawName) || shortSeasonPattern.test(rawName);
}
function uniqueValues(values) {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const value of values) {
    if (typeof value !== "string")
      continue;
    const normalized = value.normalize("NFKC").toLowerCase().trim();
    if (!normalized || seen.has(normalized))
      continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}
function scoreVod(item, metadata) {
  var _a;
  const candidateTitles = uniqueValues([
    metadata.title,
    metadata.originalTitle,
    ...Array.isArray(metadata.aliases) ? metadata.aliases : []
  ]);
  if (candidateTitles.length === 0)
    return 0;
  let maxSim = 0;
  for (const t of candidateTitles) {
    const sim = similarity(t, item.vodName);
    if (sim > maxSim)
      maxSim = sim;
  }
  if (maxSim < 0.3)
    return 0;
  let score = maxSim;
  const rawYear = String((_a = item.vodYear) != null ? _a : "").trim();
  const itemYear = Number.parseInt(rawYear.slice(0, 4), 10);
  if (Number.isFinite(itemYear)) {
    const expectedYears = [metadata.seasonYear, metadata.year, metadata.seriesYear].filter(
      (v) => Number.isInteger(v)
    );
    if (expectedYears.includes(itemYear)) {
      score += 0.3;
    } else if (expectedYears.some((y) => Math.abs(y - itemYear) <= 1)) {
      score += 0.15;
    } else if (expectedYears.length > 0 && expectedYears.every((y) => Math.abs(y - itemYear) > 3)) {
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
  var _a, _b;
  const candidates = items.filter((item) => {
    const typeId1 = getBroadTypeId(item);
    if (input.mediaType === "movie")
      return typeId1 === 1;
    return [2, 3, 4, 88].includes(typeId1);
  });
  const ranked = candidates.map((item) => ({ item, score: scoreVod(item, metadata) })).filter((entry) => entry.score >= MIN_VOD_SCORE).sort((a, b) => b.score - a.score);
  return (_b = (_a = ranked[0]) == null ? void 0 : _a.item) != null ? _b : null;
}
function searchVod(input, metadata) {
  return __async(this, null, function* () {
    const queries = Array.isArray(metadata.searchQueries) ? metadata.searchQueries : [];
    if (queries.length === 0)
      return [];
    const items = [];
    const seen = /* @__PURE__ */ new Set();
    let successCount = 0;
    let lastError = null;
    for (const query of queries) {
      try {
        const body = yield fetchRsc(`/vod/search/${encodeURIComponent(query)}`);
        successCount += 1;
        const results = extractVodItems(body);
        for (const item of results) {
          const key = String(item.vodId);
          if (seen.has(key))
            continue;
          seen.add(key);
          items.push(item);
        }
      } catch (error) {
        lastError = error;
      }
    }
    if (successCount === 0 && lastError)
      throw lastError;
    return items;
  });
}
function getDetail(vodId) {
  return __async(this, null, function* () {
    const path = `/detail/${encodeURIComponent(String(vodId))}`;
    const body = yield fetchRsc(path);
    const detail = extractMeta(body);
    if (!detail) {
      throw new Error(`\u8BE6\u60C5\u89E3\u6790\u5931\u8D25 vodId=${vodId}`);
    }
    return detail;
  });
}
function selectEpisodes(detail, input, metadata) {
  const list = Array.isArray(detail.episodeList) ? detail.episodeList : [];
  if (input.mediaType === "movie")
    return list;
  if (metadata.episodeNid != null)
    return [{ nid: metadata.episodeNid }];
  const wanted = String(input.episode);
  const byName = list.find((item) => String(item.name).trim() === wanted);
  if (byName)
    return [byName];
  const bySort = list.find((item) => Number(item.sort) === input.episode);
  if (bySort)
    return [bySort];
  const byIndex = list[input.episode - 1];
  if (byIndex)
    return [byIndex];
  return [];
}
function fetchEpisodeStreams(vodId, nid) {
  return __async(this, null, function* () {
    const params = {
      clientType: CLIENT_TYPE,
      id: String(vodId),
      nid: String(nid)
    };
    const t = Date.now();
    const sign = genSign({ method: "GET", params, t });
    const path = `/api/mw-movie/anonymous/v2/video/episode/url?${encodeQuery(params)}`;
    const response = yield fetch(`${BASE_URL}${path}`, {
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
    const body = yield response.text();
    if (!response.ok) {
      throw new Error(`\u6D41\u8BF7\u6C42\u5931\u8D25 HTTP ${response.status} nid=${nid}`);
    }
    let json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      throw new Error(`\u6D41\u54CD\u5E94\u975E JSON nid=${nid}`);
    }
    if (!json || json.code !== 200) {
      throw new Error(`\u6D41 API \u9519\u8BEF: ${(json == null ? void 0 : json.msg) || "unknown"} nid=${nid}`);
    }
    const list = json.data && Array.isArray(json.data.list) ? json.data.list : [];
    return list;
  });
}
function toStream(item, { vodName, tmdbId, vodId, nid } = {}) {
  if (!item || !item.url)
    return null;
  const rawUrl = String(item.url).trim();
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
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
function getStreams(tmdbId, mediaType, season = null, episode = null) {
  return __async(this, null, function* () {
    let step = "init";
    try {
      step = "normalizeInput";
      const input = normalizeInput(tmdbId, mediaType, season, episode);
      step = "resolveTmdbMetadata";
      const metadata = yield resolveTmdbMetadata(input);
      if (!metadata || !metadata.title) {
        throw new Error("TMDB \u5143\u6570\u636E\u4E0D\u5B8C\u6574");
      }
      step = "searchVod";
      const items = yield searchVod(input, metadata);
      step = "pickVod";
      const vod = pickVod(items, input, metadata);
      if (!vod) {
        return [];
      }
      step = "getDetail";
      const detail = yield getDetail(vod.vodId);
      const vodName = detail.vodName || detail.name || metadata.title || "";
      step = "selectEpisodes";
      const episodes = selectEpisodes(detail, input, metadata);
      if (episodes.length === 0) {
        throw new Error(`\u672A\u5339\u914D\u5230\u7B2C ${episode} \u96C6`);
      }
      step = "fetchEpisodeStreams";
      const streams = [];
      const seen = /* @__PURE__ */ new Set();
      let lastError = null;
      for (const episodeItem of episodes) {
        if (episodeItem.nid == null)
          continue;
        try {
          const items2 = yield fetchEpisodeStreams(vod.vodId, episodeItem.nid);
          for (const item of items2) {
            const stream = toStream(item, {
              vodName,
              tmdbId: input.tmdbId,
              vodId: vod.vodId,
              nid: episodeItem.nid
            });
            if (!stream)
              continue;
            if (seen.has(stream.url))
              continue;
            seen.add(stream.url);
            streams.push(stream);
          }
        } catch (error) {
          lastError = error;
        }
      }
      if (streams.length === 0) {
        if (lastError)
          throw lastError;
        throw new Error("\u672A\u83B7\u53D6\u5230\u4EFB\u4F55\u6D41\u5730\u5740");
      }
      return streams;
    } catch (e) {
      return [
        {
          name: PROVIDER_NAME,
          title: `[${step}] ${e.message}`,
          url: "https://test.com/error",
          quality: "ERROR"
        }
      ];
    }
  });
}

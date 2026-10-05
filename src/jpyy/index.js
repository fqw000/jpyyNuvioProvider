// src/jpyy/index.js

import { genSign } from "./sign.js";
import {
  extractMeta,
  extractVodItems,
} from "./rsc.js";
import {
  resolveTmdbMetadata,
} from "./tmdb-resolver.js";

const PROVIDER_NAME = "jpyy";
const BASE_URL = "https://0996zp.com";
const CLIENT_TYPE = 1;
const DEVICE_ID = "39cb57bc-f77b-42c8-84e8-25fe857385d1";

const TV_TYPE_IDS = new Set([2, 3, 4, 88]);

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

function positiveInteger(value, fieldName) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return number;
}

function normalizeInput(
  tmdbId,
  mediaType,
  season,
  episode,
) {
  const normalizedId = String(tmdbId ?? "").trim();
  const normalizedType = String(mediaType ?? "")
    .trim()
    .toLowerCase();

  if (!normalizedId) {
    throw new Error("tmdbId is required");
  }

  if (
    normalizedType !== "movie" &&
    normalizedType !== "tv"
  ) {
    throw new Error(
      'mediaType must be either "movie" or "tv"',
    );
  }

  if (normalizedType === "movie") {
    return {
      tmdbId: normalizedId,
      mediaType: normalizedType,
      season: null,
      episode: null,
    };
  }

  return {
    tmdbId: normalizedId,
    mediaType: normalizedType,
    season: positiveInteger(season, "season"),
    episode: positiveInteger(episode, "episode"),
  };
}

function encodeQuery(params) {
  return Object.keys(params)
    .map(
      (key) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(
          String(params[key]),
        )}`,
    )
    .join("&");
}

async function fetchRsc(path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Accept: "*/*",
      RSC: "1",
      "Next-Url": path,
      Referer: `${BASE_URL}${path}`,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/153.0.0.0 Safari/537.36",
    },
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `jpyy RSC request failed: HTTP ${response.status}`,
    );
  }

  return body;
}

function getBroadTypeId(item) {
  return Number(item.typeId1);
}

// function normalizeName(value) {
//   return String(value ?? "")
//     .toLowerCase()
//     .replace(/\s+/g, "")
//     .replace(
//       /[\s\-_:：,，。.!！?？()（）\[\]【】]/g,
//       "",
//     );
// }

// function chineseNumber(value) {
//   const numbers = [
//     "零",
//     "一",
//     "二",
//     "三",
//     "四",
//     "五",
//     "六",
//     "七",
//     "八",
//     "九",
//     "十",
//   ];

//   if (value >= 0 && value <= 10) {
//     return numbers[value];
//   }

//   return String(value);
// }

// function seasonMarkers(season) {
//   return [
//     `第${season}季`,
//     `第${chineseNumber(season)}季`,
//     `season ${season}`,
//   ];
// }

// function scoreVod(item, metadata) {
//   const targetNames = [
//     metadata.title,
//     ...(Array.isArray(metadata.aliases)
//       ? metadata.aliases
//       : []),
//   ]
//     .filter(Boolean)
//     .map(normalizeName);

//   if (targetNames.length === 0) {
//     return -1;
//   }

//   const itemNames = [
//     item.vodName,
//     item.vodSub,
//   ]
//     .filter(Boolean)
//     .map(normalizeName);

//   let score = 0;

//   for (const target of targetNames) {
//     for (const name of itemNames) {
//       if (name === target) {
//         score = Math.max(score, 100);
//       } else if (name.includes(target)) {
//         score = Math.max(score, 70);
//       } else if (
//         name.length >= 2 &&
//         target.includes(name)
//       ) {
//         score = Math.max(score, 50);
//       }
//     }
//   }

//   if (
//     metadata.year &&
//     String(item.vodYear) === String(metadata.year)
//   ) {
//     score += 20;
//   }

//   if (metadata.season != null) {
//     const rawName = [
//       item.vodName,
//       item.vodSub,
//     ]
//       .filter(Boolean)
//       .join(" ")
//       .toLowerCase();

//     if (
//       seasonMarkers(metadata.season).some(
//         (marker) =>
//           rawName.includes(marker.toLowerCase()),
//       )
//     ) {
//       score += 40;
//     }
//   }

//   return score;
// }

// function pickVod(items, input, metadata) {
//   const expectedType =
//     input.mediaType === "movie"
//       ? 1
//       : null;

//   const candidates = items.filter((item) => {
//     const typeId1 = getBroadTypeId(item);

//     if (expectedType !== null) {
//       return typeId1 === expectedType;
//     }

//     return TV_TYPE_IDS.has(typeId1);
//   });

//   const ranked = candidates
//     .map((item) => ({
//       item,
//       score: scoreVod(item, metadata),
//     }))
//     .filter((entry) => entry.score > 0)
//     .sort((a, b) => b.score - a.score);

//   return ranked[0]?.item ?? null;
// }

// async function searchVod(input, metadata) {
//   const query =
//     metadata.searchTitle ||
//     [
//       metadata.title,
//       metadata.season != null && metadata.season > 1
//         ? seasonMarkers(metadata.season)[1]
//         : "",
//     ]
//       .filter(Boolean)
//       .join(" ");

//   const path =
//     `/vod/search/${encodeURIComponent(query)}`;

//   const body = await fetchRsc(path);

//   return extractVodItems(body);
// }

const MIN_VOD_SCORE = 120;

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function scoreTitleMatch(candidate, target) {
  const normalizedCandidate = normalizeName(candidate);
  const normalizedTarget = normalizeName(target);

  if (
    !normalizedCandidate ||
    !normalizedTarget
  ) {
    return 0;
  }

  if (normalizedCandidate === normalizedTarget) {
    return 200;
  }

  const shortestLength = Math.min(
    normalizedCandidate.length,
    normalizedTarget.length,
  );

  if (shortestLength < 2) {
    return 0;
  }

  const containsChinese =
    /[\u3400-\u9fff]/u.test(normalizedTarget);

  /*
   * 英文短标题避免用 "it"、"up" 之类做子串匹配。
   */
  if (
    !containsChinese &&
    normalizedTarget.length < 4
  ) {
    return 0;
  }

  const candidateContainsTarget =
    normalizedCandidate.includes(normalizedTarget);

  const targetContainsCandidate =
    normalizedTarget.includes(normalizedCandidate);

  if (
    !candidateContainsTarget &&
    !targetContainsCandidate
  ) {
    return 0;
  }

  const ratio =
    shortestLength /
    Math.max(
      normalizedCandidate.length,
      normalizedTarget.length,
    );

  if (ratio >= 0.6) {
    return 120;
  }

  return 85;
}

function scoreYearMatch(item, metadata) {
  const rawYear = String(
    item.vodYear ?? "",
  ).trim();

  const itemYear = Number.parseInt(
    rawYear.slice(0, 4),
    10,
  );

  if (!Number.isFinite(itemYear)) {
    return 0;
  }

  const expectedYears = [
    metadata.seasonYear,
    metadata.year,
    metadata.seriesYear,
  ].filter(
    (value) => Number.isInteger(value),
  );

  if (expectedYears.includes(itemYear)) {
    return 60;
  }

  if (
    expectedYears.some(
      (year) => Math.abs(year - itemYear) <= 1,
    )
  ) {
    return 15;
  }

  return 0;
}

function hasSeasonMarker(item, metadata) {
  const rawName = String(
    item.vodName ?? "",
  )
    .normalize("NFKC")
    .toLowerCase();

  const normalizedName = normalizeName(rawName);

  const labels = Array.isArray(metadata.seasonLabels)
    ? metadata.seasonLabels
    : [];

  const normalizedLabelMatch = labels.some(
    (label) => {
      const normalizedLabel = normalizeName(label);

      return (
        normalizedLabel.length >= 2 &&
        normalizedName.includes(normalizedLabel)
      );
    },
  );

  if (normalizedLabelMatch) {
    return true;
  }

  const season = metadata.season;

  if (!Number.isInteger(season)) {
    return false;
  }

  const escapedSeason = String(season).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );

  const chineseSeasonPattern = new RegExp(
    `第\\s*0*${escapedSeason}\\s*季(?![0-9])`,
    "i",
  );

  const englishSeasonPattern = new RegExp(
    `(?:season)\\s*0*${escapedSeason}(?![0-9])`,
    "i",
  );

  const shortSeasonPattern = new RegExp(
    `(?:^|[^a-z0-9])s\\s*0*${escapedSeason}(?![0-9])`,
    "i",
  );

  return (
    chineseSeasonPattern.test(rawName) ||
    englishSeasonPattern.test(rawName) ||
    shortSeasonPattern.test(rawName)
  );
}

function scoreVod(item, metadata) {
  const targetTitles = uniqueValues([
    metadata.title,
    metadata.originalTitle,
    ...(Array.isArray(metadata.aliases)
      ? metadata.aliases
      : []),
  ]);

  let titleScore = 0;

  for (const target of targetTitles) {
    titleScore = Math.max(
      titleScore,
      scoreTitleMatch(
        item.vodName,
        target,
      ),
    );
  }

  if (titleScore <= 0) {
    return 0;
  }

  let score = titleScore;

  score += scoreYearMatch(
    item,
    metadata,
  );

  if (hasSeasonMarker(item, metadata)) {
    score += 60;
  }

  return score;
}

function uniqueValues(values) {
  const result = [];
  const seen = new Set();

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const normalized = value
      .normalize("NFKC")
      .toLowerCase()
      .trim();

    if (
      !normalized ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    result.push(value);
  }

  return result;
}

function pickVod(
  items,
  input,
  metadata,
) {
  const candidates = items.filter((item) => {
    const typeId1 = getBroadTypeId(item);

    if (input.mediaType === "movie") {
      return typeId1 === 1;
    }

    /*
     * JPYY 的电视剧、综艺、动漫、短剧大类。
     */
    return [2, 3, 4, 88].includes(typeId1);
  });

  const ranked = candidates
    .map((item) => ({
      item,
      score: scoreVod(item, metadata),
    }))
    .filter(
      (entry) => entry.score >= MIN_VOD_SCORE,
    )
    .sort(
      (a, b) => b.score - a.score,
    );

  return ranked[0]?.item ?? null;
}

async function searchVod(
  input,
  metadata,
) {
  const queries = Array.isArray(
    metadata.searchQueries,
  )
    ? metadata.searchQueries
    : [];

  if (queries.length === 0) {
    return [];
  }

  const items = [];
  const seen = new Set();

  let successCount = 0;
  let lastError = null;

  for (const query of queries) {
    try {
      /*
       * 如果你的 MD 中实际搜索地址不同，
       * 只需要调整这一行。
       */
      const body = await fetchRsc(
        `/vod/search/${encodeURIComponent(query)}`,
      );

      successCount += 1;

      const results =
        extractVodItems(body);

      for (const item of results) {
        const key = String(item.vodId);

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        items.push(item);
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (
    successCount === 0 &&
    lastError
  ) {
    throw lastError;
  }

  return items;
}




async function getDetail(vodId) {
  const path =
    `/detail/${encodeURIComponent(String(vodId))}`;

  const body = await fetchRsc(path);
  const detail = extractMeta(body);

  if (!detail) {
    throw new Error(
      `jpyy detail parsing failed for vodId=${vodId}`,
    );
  }

  return detail;
}

function selectEpisodes(
  detail,
  input,
  metadata,
) {
  const list = Array.isArray(detail.episodeList)
    ? detail.episodeList
    : [];

  if (input.mediaType === "movie") {
    return list;
  }

  if (metadata.episodeNid != null) {
    return [
      {
        nid: metadata.episodeNid,
      },
    ];
  }

  const wanted = String(input.episode);

  const byName = list.find(
    (item) => String(item.name).trim() === wanted,
  );

  if (byName) {
    return [byName];
  }

  const bySort = list.find(
    (item) => Number(item.sort) === input.episode,
  );

  if (bySort) {
    return [bySort];
  }

  const byIndex = list[input.episode - 1];

  if (byIndex) {
    return [byIndex];
  }

  return [];
}

async function fetchEpisodeStreams(
  vodId,
  nid,
) {
  const params = {
    clientType: CLIENT_TYPE,
    id: String(vodId),
    nid: String(nid),
  };

  const t = Date.now();

  const sign = genSign({
    method: "GET",
    params,
    t,
  });

  const path =
    "/api/mw-movie/anonymous/v2/video/episode/url" +
    `?${encodeQuery(params)}`;

  const response = await fetch(
    `${BASE_URL}${path}`,
    {
      method: "GET",
      headers: {
        Accept:
          "application/json, text/plain, */*",
        "client-type": String(CLIENT_TYPE),
        deviceId: DEVICE_ID,
        sign,
        t: String(t),
        authorization: "",
        Referer:
          `${BASE_URL}/vod/play/${vodId}/sid/${nid}`,
      },
    },
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `jpyy stream request failed: HTTP ${response.status}`,
    );
  }

  let json;

  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(
      "jpyy stream response is not valid JSON",
    );
  }

  if (!json || json.code !== 200) {
    throw new Error(
      `jpyy stream API error: ${json?.msg || "unknown error"
      }`,
    );
  }

  const list =
    json.data && Array.isArray(json.data.list)
      ? json.data.list
      : [];

  return list;
}

// toStrem 引入了stream返回影片名称的参数
function toStream(
  item,
  {
    vodName,
    tmdbId,
    vodId,
    nid,
  } = {},
)  {
  if (!item || !item.url) {
    return null;
  }

  // 验证返回数据中是否包含登录认证，避免无法认证播放失效
  // const needLogin =
  //   item.needLogin === true ||
  //   String(item.needLogin).toLowerCase() === "true";

  // if (needLogin) {
  //   return null;
  // }

  const rawUrl = String(item.url).trim();

  try {
    const parsed = new URL(rawUrl);

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      return null;
    }
  } catch {
    return null;
  }

  const resolution = Number(item.resolution);

  const quality = Number.isFinite(resolution)
    ? `${Math.round(resolution)}p`
    : "unknown";

  const resolutionName = String(
    item.resolutionName || "",
  ).trim();

  const title = resolutionName
    ? `${resolutionName} ${quality}`
    : `JPYY ${quality}`;

  return {
    name: vodName || PROVIDER_NAME,
    title: `${tmdbId} - ${vodId} - ${nid}`,
    url: rawUrl,
    quality,
  };
}

async function resolveMedia(input) {
  /*
   * 必须在这里接入：
   *
   * 1. TMDB ID → 标题、年份、别名
   * 2. 电视剧 TMDB ID + season → 站内 vodId
   * 3. 特殊编号 → episodeNid
   *
   * 返回示例：
   *
   * {
   *   title: "阿甘正传",
   *   year: 1994,
   *   aliases: [],
   *   typeId1: 1,
   *   vodId: "59460"
   * }
   *
   * 电视剧：
   *
   * {
   *   title: "某电视剧",
   *   year: 2024,
   *   typeId1: 2,
   *   season: 2,
   *   vodId: "站点第二季的 vodId"
   * }
   */
  return resolveTmdbMetadata(input);
}

export async function getStreams(
  tmdbId,
  mediaType,
  season = null,
  episode = null,
) {
  const input = normalizeInput(
    tmdbId,
    mediaType,
    season,
    episode,
  );

  const metadata = await resolveMedia(input);

  if (
    !metadata ||
    (!metadata.title && metadata.vodId == null)
  ) {
    throw new Error(
      "TMDB resolver returned incomplete metadata",
    );
  }

  let vod = null;

  if (metadata.vodId != null) {
    vod = {
      vodId: metadata.vodId,
    };
  } else {
    const items = await searchVod(
      input,
      metadata,
    );

    vod = pickVod(
      items,
      input,
      metadata,
    );
  }

  if (!vod) {
    return [];
  }

  // const detail = await getDetail(vod.vodId);

  // const episodes = selectEpisodes(
  //   detail,
  //   input,
  //   metadata,
  // );

  // const streams = [];
  // const seen = new Set();

  // let lastError = null;

  // for (const episodeItem of episodes) {
  //   if (episodeItem.nid == null) {
  //     continue;
  //   }

  //   try {
  //     const items = await fetchEpisodeStreams(
  //       vod.vodId,
  //       episodeItem.nid,
  //     );

  //     for (const item of items) {
  //       const stream = toStream(item);

  //       if (!stream) {
  //         continue;
  //       }

  //       if (seen.has(stream.url)) {
  //         continue;
  //       }

  //       seen.add(stream.url);
  //       streams.push(stream);
  //     }
  //   } catch (error) {
  //     lastError = error;
  //   }
  // }

  const detail = await getDetail(vod.vodId);

  /*
   * 取影片名称，字段名按 extractMeta 的实际返回调整。
   * 常见是 detail.vodName，也可能是 detail.name。
   */
  const vodName =
    detail.vodName ||
    detail.name ||
    metadata.title ||
    "";

  const episodes = selectEpisodes(
    detail,
    input,
    metadata,
  );

  const streams = [];
  const seen = new Set();

  let lastError = null;

  for (const episodeItem of episodes) {
    if (episodeItem.nid == null) {
      continue;
    }

    try {
      const items = await fetchEpisodeStreams(
        vod.vodId,
        episodeItem.nid,
      );

      for (const item of items) {
        const stream = toStream(item, {
          vodName,
          tmdbId: input.tmdbId,
          vodId: vod.vodId,
          nid: episodeItem.nid,
        });

        if (!stream) {
          continue;
        }

        if (seen.has(stream.url)) {
          continue;
        }

        seen.add(stream.url);
        streams.push(stream);
      }
    } catch (error) {
      lastError = error;
    }
  }


  if (streams.length === 0 && lastError) {
    throw lastError;
  }

  return streams;
}
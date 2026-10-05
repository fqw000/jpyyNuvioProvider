const TMDB_API_KEY = "e5c3c7269a147fee368c3649ddd98875";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

const CACHE_TTL = 6 * 60 * 60 * 1000;
const metadataCache = new Map();

function checkApiKey() {
  if (!TMDB_API_KEY || TMDB_API_KEY === "3fa903159384423972387659a870b62f") {
    throw new Error("TMDB_API_KEY is not configured");
  }
}

function uniqueTitles(values) {
  const result = [];
  const seen = new Set();

  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }

      return;
    }

    if (typeof value !== "string") {
      return;
    }

    const title = value.trim();

    if (!title) {
      return;
    }

    const key = title
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, " ");

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    result.push(title);
  }

  for (const value of values) {
    visit(value);
  }

  return result;
}

function getYear(value) {
  const match = /^(\d{4})/.exec(String(value ?? ""));

  return match ? Number(match[1]) : null;
}

function chineseNumber(value) {
  const digits = [
    "零",
    "一",
    "二",
    "三",
    "四",
    "五",
    "六",
    "七",
    "八",
    "九",
  ];

  const number = Number(value);

  if (number >= 0 && number <= 10) {
    return digits[number];
  }

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

async function tmdbGet(path, params = {}) {
  checkApiKey();

  const url = new URL(`${TMDB_BASE_URL}/${path}`);

  url.searchParams.set("api_key", TMDB_API_KEY);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `TMDB returned invalid JSON: HTTP ${response.status}`,
    );
  }

  if (!response.ok) {
    const message =
      data?.status_message ||
      data?.message ||
      response.statusText;

    throw new Error(
      `TMDB request failed: HTTP ${response.status}, ${message}`,
    );
  }

  return data;
}

async function optionalTmdbGet(path, params = {}) {
  try {
    return await tmdbGet(path, params);
  } catch {
    /*
     * alternative_names 和 translations 属于增强数据。
     * 即使接口暂时不可用，也不应阻断主流程。
     */
    return null;
  }
}

function extractExtraTitles(alternative, translations) {
  const alternativeItems =
    alternative?.titles ??
    alternative?.results ??
    [];

  const translationItems = translations?.data ?? [];

  return uniqueTitles([
    ...alternativeItems.map(
      (item) =>
        item.title ??
        item.name ??
        item.original_title ??
        item.original_name,
    ),
    ...translationItems.map(
      (item) => item.title ?? item.name,
    ),
  ]);
}

function buildMovieSearchQueries(titles, year) {
  const baseQueries = titles.slice(0, 6);

  const yearQueries = year
    ? titles
        .slice(0, 2)
        .map((title) => `${title} ${year}`)
    : [];

  return uniqueTitles([
    ...baseQueries,
    ...yearQueries,
  ]).slice(0, 8);
}

function buildTvSearchQueries(
  titles,
  season,
  seasonName,
  seasonYear,
  seriesYear,
) {
  const baseQueries = titles.slice(0, 6);

  const seasonLabels = uniqueTitles([
    seasonName,
    `第${season}季`,
    `第${chineseNumber(season)}季`,
    `Season ${season}`,
  ]);

  const seasonQueries = [];

  for (const title of titles.slice(0, 3)) {
    for (const label of seasonLabels.slice(0, 2)) {
      seasonQueries.push(`${title} ${label}`);
    }
  }

  const queryYear = seasonYear ?? seriesYear;

  const yearQueries = queryYear
    ? titles
        .slice(0, 2)
        .map((title) => `${title} ${queryYear}`)
    : [];

  return uniqueTitles([
    ...baseQueries,
    ...seasonQueries.slice(0, 4),
    ...yearQueries,
  ]).slice(0, 12);
}

function readCache(key) {
  const cached = metadataCache.get(key);

  if (!cached) {
    return null;
  }

  if (Date.now() - cached.time >= CACHE_TTL) {
    metadataCache.delete(key);
    return null;
  }

  return cached.value;
}

function writeCache(key, value) {
  metadataCache.set(key, {
    time: Date.now(),
    value,
  });
}

export async function resolveTmdbMetadata({
  tmdbId,
  mediaType,
  season = null,
}) {
  const id = String(tmdbId ?? "").trim();
  const type = String(mediaType ?? "")
    .trim()
    .toLowerCase();

  if (!/^\d+$/.test(id)) {
    throw new Error(`Invalid TMDB ID: ${tmdbId}`);
  }

  if (type !== "movie" && type !== "tv") {
    throw new Error(
      `Unsupported media type: ${mediaType}`,
    );
  }

  if (
    type === "tv" &&
    (
      !Number.isInteger(season) ||
      season < 0
    )
  ) {
    throw new Error(
      `Invalid season: ${season}`,
    );
  }

  const cacheKey =
    `${type}:${id}:${season ?? "-"}`;

  const cached = readCache(cacheKey);

  if (cached) {
    return cached;
  }

  const typePath = type === "movie" ? "movie" : "tv";

  const detail = await tmdbGet(
    `${typePath}/${encodeURIComponent(id)}`,
    {
      language: "zh-CN",
    },
  );

  if (type === "movie") {
    const [alternative, translations] =
      await Promise.all([
        optionalTmdbGet(
          `movie/${encodeURIComponent(id)}/alternative_names`,
        ),
        optionalTmdbGet(
          `movie/${encodeURIComponent(id)}/translations`,
        ),
      ]);

    const extraTitles = extractExtraTitles(
      alternative,
      translations,
    );

    const titles = uniqueTitles([
      detail.title,
      detail.original_title,
      ...extraTitles,
    ]);

    if (titles.length === 0) {
      throw new Error(
        `TMDB movie has no usable title: ${id}`,
      );
    }

    const year = getYear(detail.release_date);

    const result = {
      tmdbId: id,
      mediaType: "movie",
      title: titles[0],
      originalTitle:
        detail.original_title ?? null,
      aliases: titles.slice(1),
      year,
      seriesYear: null,
      seasonYear: null,
      season: null,
      seasonLabels: [],
      expectedEpisodeCount: null,
      searchQueries:
        buildMovieSearchQueries(titles, year),
    };

    writeCache(cacheKey, result);

    return result;
  }

  const [alternative, translations, seasonDetail] =
    await Promise.all([
      optionalTmdbGet(
        `tv/${encodeURIComponent(id)}/alternative_names`,
      ),
      optionalTmdbGet(
        `tv/${encodeURIComponent(id)}/translations`,
      ),
      optionalTmdbGet(
        [
          `tv/${encodeURIComponent(id)}`,
          `season/${encodeURIComponent(season)}`,
        ].join("/"),
        {
          language: "zh-CN",
        },
      ),
    ]);

  const extraTitles = extractExtraTitles(
    alternative,
    translations,
  );

  const titles = uniqueTitles([
    detail.name,
    detail.original_name,
    ...extraTitles,
  ]);

  if (titles.length === 0) {
    throw new Error(
      `TMDB TV series has no usable title: ${id}`,
    );
  }

  const seriesYear = getYear(detail.first_air_date);
  const seasonYear = getYear(seasonDetail?.air_date);

  const expectedEpisodeCount =
    Array.isArray(seasonDetail?.episodes)
      ? seasonDetail.episodes.length
      : null;

  const result = {
    tmdbId: id,
    mediaType: "tv",
    title: titles[0],
    originalTitle:
      detail.original_name ?? null,
    aliases: titles.slice(1),
    year: seasonYear ?? seriesYear,
    seriesYear,
    seasonYear,
    season,
    seasonName:
      seasonDetail?.name ?? null,
    seasonLabels: uniqueTitles([
      seasonDetail?.name,
      `第${season}季`,
      `第${chineseNumber(season)}季`,
      `Season ${season}`,
    ]),
    expectedEpisodeCount,
    searchQueries: buildTvSearchQueries(
      titles,
      season,
      seasonDetail?.name,
      seasonYear,
      seriesYear,
    ),
  };

  writeCache(cacheKey, result);

  return result;
}
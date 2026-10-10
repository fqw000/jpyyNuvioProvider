// providers/jpyy.js
const CryptoJS = require('crypto-js');

const PROVIDER_NAME = 'jpyy';
const BASE_URL = 'https://0996zp.com';
const CLIENT_TYPE = 1;
// const DEVICE_ID = '39cb57bc-f77b-42c8-84e8-25fe857385d1';
const TMDB_API_KEY = 'e5c3c7269a147fee368c3649ddd98875';
const SIGN_KEY = 'cb808529bae6b6be45ecfab29a4889bc';
const MIN_VOD_SCORE = 0.5;

const rscCache = new Map();
const RSC_CACHE_TTL = 5 * 60 * 1000;
const tmdbCache = new Map();
const TMDB_CACHE_TTL = 6 * 60 * 60 * 1000;

// ==========================================
// 工具
// ==========================================
function uniqueValues(values) {
  var result = [];
  var seen = new Set();
  for (var i = 0; i < values.length; i++) {
    var value = values[i];
    if (typeof value !== 'string') continue;
    var normalized = value.normalize('NFKC').toLowerCase().trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

function jaccardSimilarity(a, b) {
  var setA = {}, setB = {};
  for (var i = 0; i < a.length; i++) setA[a[i]] = true;
  for (var j = 0; j < b.length; j++) setB[b[j]] = true;
  var intersection = 0, union = 0;
  for (var k in setA) { if (setB[k]) intersection++; union++; }
  for (var m in setB) { if (!setA[m]) union++; }
  return union === 0 ? 0 : intersection / union;
}

function similarity(s1, s2) {
  if (!s1 || !s2) return 0;
  s1 = String(s1).toLowerCase().trim();
  s2 = String(s2).toLowerCase().trim();
  if (s1 === s2) return 1.0;
  if (s1.indexOf(s2) !== -1 || s2.indexOf(s1) !== -1) return 0.85;

  var hasChinese1 = /[\u4e00-\u9fa5]/.test(s1);
  var hasChinese2 = /[\u4e00-\u9fa5]/.test(s2);
  if (hasChinese1 && hasChinese2) {
    var j = jaccardSimilarity(s1, s2);
    var lenRatio = Math.min(s1.length, s2.length) / Math.max(s1.length, s2.length);
    return (j + lenRatio) / 2;
  }

  var a = s1, b = s2;
  if (a.length < b.length) { var tmp = a; a = b; b = tmp; }
  var lenA = a.length, lenB = b.length;
  if (lenA === 0 || lenB === 0) return 0;
  var prev = new Array(lenB + 1);
  var curr = new Array(lenB + 1);
  for (var j2 = 0; j2 <= lenB; j2++) prev[j2] = j2;
  for (var i2 = 1; i2 <= lenA; i2++) {
    curr[0] = i2;
    for (var k2 = 1; k2 <= lenB; k2++) {
      var cost = a[i2 - 1] === b[k2 - 1] ? 0 : 1;
      curr[k2] = Math.min(prev[k2] + 1, curr[k2 - 1] + 1, prev[k2 - 1] + cost);
    }
    var tmp2 = prev; prev = curr; curr = tmp2;
  }
  return 1 - prev[lenB] / Math.max(lenA, lenB);
}

function quickReject(a, b) {
  if (!a || !b) return true;
  var maxLen = Math.max(a.length, b.length);
  var minLen = Math.min(a.length, b.length);
  if (minLen === 0) return true;
  if (minLen / maxLen < 0.4) return true;
  var aSet = {};
  for (var i = 0; i < a.length; i++) aSet[a[i]] = true;
  for (var j = 0; j < b.length; j++) {
    if (aSet[b[j]]) return false;
  }
  return true;
}

function getTitlePriority(title) {
  if (!title) return -1;
  var chineseCount = (title.match(/[\u4e00-\u9fa5]/g) || []).length;
  var totalLength = title.length;
  if (/^[\u4e00-\u9fa5]+$/.test(title)) return 3;
  if (chineseCount / totalLength > 0.5) return 2;
  return 0;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

function hasSeasonMarker(item, metadata) {
  var rawName = String(item.vodName || '').normalize('NFKC').toLowerCase();
  var normalizedName = normalizeName(rawName);
  var labels = Array.isArray(metadata.seasonLabels) ? metadata.seasonLabels : [];
  for (var i = 0; i < labels.length; i++) {
    if (!labels[i]) continue;
    var normalizedLabel = normalizeName(labels[i]);
    if (normalizedLabel.length >= 2 && normalizedName.indexOf(normalizedLabel) !== -1) return true;
  }
  var season = metadata.season;
  if (!Number.isInteger(season)) return false;
  var escapedSeason = String(season).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var cn = new RegExp('第\\s*0*' + escapedSeason + '\\s*季(?![0-9])', 'i');
  var en = new RegExp('(?:season)\\s*0*' + escapedSeason + '(?![0-9])', 'i');
  var sn = new RegExp('(?:^|[^a-z0-9])s\\s*0*' + escapedSeason + '(?![0-9])', 'i');
  return cn.test(rawName) || en.test(rawName) || sn.test(rawName);
}

function hasWrongSeasonMark(vodName, targetSeason) {
  if (!vodName || !Number.isInteger(targetSeason)) return false;
  var re = /第\s*(\d+)\s*季|(?:^|[^a-z0-9])S(\d+)(?![0-9])/gi;
  var m;
  while ((m = re.exec(vodName)) !== null) {
    var num = parseInt(m[1] || m[2], 10);
    if (!Number.isNaN(num) && num !== targetSeason) return true;
  }
  return false;
}

function chineseNumber(value) {
  var digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  var number = Number(value);
  if (number >= 0 && number <= 10) return digits[number];
  if (number > 10 && number < 20) return '十' + (number % 10 ? digits[number % 10] : '');
  if (number >= 20 && number < 100) {
    var tens = digits[Math.floor(number / 10)];
    var ones = number % 10 ? digits[number % 10] : '';
    return tens + '十' + ones;
  }
  return String(number);
}

/**
 * 生成 UUID v4
 * 
 * 用于替代固定 Device ID，避免被站点识别为爬虫
 * 每次 Worker 实例启动时生成一次
 * 
 * @returns {string} UUID 字符串
 */
function getUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ==========================================
// 签名
// ==========================================
function genSign(opts) {
  var method = opts.method || 'GET';
  var params = opts.params || {};
  var t = opts.t;
  var signKey = opts.signKey || SIGN_KEY;
  var g = '';
  if (method.toUpperCase() === 'GET') {
    var keys = Object.keys(params).sort();
    g = keys.length ? keys.map(function (k) { return k + '=' + params[k]; }).join('&') : '';
  } else {
    g = Object.keys(params).length ? JSON.stringify(params) : '';
  }
  var h = g ? g + '&key=' + signKey + '&t=' + t : 'key=' + signKey + '&t=' + t;
  var md5 = CryptoJS.MD5(h).toString();
  return CryptoJS.SHA1(md5).toString();
}

// ==========================================
// RSC 解析（非递归 walk）
// ==========================================
function parseRscRecords(body) {
  var values = [];
  var current = null;
  function flush() {
    if (!current) return;
    try { values.push(JSON.parse(current.raw.trim())); } catch (e) { }
    current = null;
  }
  var lines = String(body).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var match = line.match(/^([0-9a-f]+):\s?(.*)$/i);
    if (match) {
      flush();
      current = { raw: match[2] };
    } else if (current) {
      current.raw += '\n' + line;
    }
  }
  flush();
  if (values.length === 0) {
    try { values.push(JSON.parse(body)); } catch (e) { }
  }
  return values;
}

function walk(value, visitor) {
  var stack = [value];
  while (stack.length > 0) {
    var current = stack.pop();
    if (Array.isArray(current)) {
      for (var i = current.length - 1; i >= 0; i--) stack.push(current[i]);
      continue;
    }
    if (current === null || typeof current !== 'object') continue;
    visitor(current);
    var keys = Object.keys(current);
    for (var j = keys.length - 1; j >= 0; j--) stack.push(current[keys[j]]);
  }
}

function isVodItem(value) {
  return value && typeof value === 'object' && value.vodId !== undefined && value.vodId !== null;
}

function extractVodItems(body) {
  var records = parseRscRecords(body);
  var result = [];
  var seen = new Set();
  for (var i = 0; i < records.length; i++) {
    (function (record) {
      walk(record, function (node) {
        if (!Array.isArray(node.list)) return;
        for (var k = 0; k < node.list.length; k++) {
          var item = node.list[k];
          if (!isVodItem(item)) continue;
          var key = String(item.vodId);
          if (!seen.has(key)) {
            seen.add(key);
            result.push(item);
          }
        }
      });
    })(records[i]);
  }
  return result;
}

function extractMeta(body) {
  var records = parseRscRecords(body);
  var found = null;
  for (var i = 0; i < records.length; i++) {
    walk(records[i], function (node) {
      if (!found && node && node.vodId !== undefined && node.vodId !== null && Array.isArray(node.episodeList)) {
        found = node;
      }
    });
    if (found) return found;
  }
  return null;
}

// ==========================================
// TMDB
// ==========================================
function tmdbGet(path, params) {
  params = params || {};
  var query = 'api_key=' + TMDB_API_KEY;
  var keys = Object.keys(params);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value = params[key];
    if (value !== undefined && value !== null) {
      query += '&' + key + '=' + encodeURIComponent(value);
    }
  }
  var url = 'https://api.themoviedb.org/3/' + path + '?' + query;
  return fetch(url, { headers: { Accept: 'application/json' } })
    .then(function (res) {
      return res.text().then(function (text) {
        var data;
        try { data = JSON.parse(text); } catch (e) { throw new Error('TMDB invalid JSON'); }
        if (!res.ok) throw new Error('TMDB HTTP ' + res.status + ': ' + (data.status_message || res.statusText));
        return data;
      });
    });
}

function optionalTmdbGet(path, params) {
  return tmdbGet(path, params).catch(function () { return null; });
}

function extractExtraTitles(alternative, translations) {
  var altItems = (alternative && alternative.titles) ? alternative.titles : [];
  var transItems = (translations && translations.translations) ? translations.translations : [];
  var raw = [];
  for (var i = 0; i < altItems.length; i++) {
    if (altItems[i].title) raw.push(altItems[i].title);
  }
  for (var j = 0; j < transItems.length; j++) {
    var item = transItems[j];
    if (item && item.data && item.data.title) raw.push(item.data.title);
  }
  var uniq = uniqueValues(raw);
  uniq.sort(function (a, b) { return getTitlePriority(b) - getTitlePriority(a); });
  return uniq;
}

function normalizeQueryKey(s) {
  return String(s).toLowerCase().replace(/\s+/g, '').replace(/[0-9]/g, function (d) {
    return '零一二三四五六七八九'[Number(d)] || d;
  });
}

function buildMovieSearchQueries(titles, year) {
  var seen = {};
  var result = [];
  for (var i = 0; i < titles.length && result.length < 2; i++) {
    var key = normalizeQueryKey(titles[i]);
    if (seen[key]) continue;
    seen[key] = true;
    result.push(titles[i]);
  }
  if (year && result.length < 3) {
    var yearTitle = titles[0] + ' ' + year;
    var yKey = normalizeQueryKey(yearTitle);
    if (!seen[yKey]) result.push(yearTitle);
  }
  return result.slice(0, 3);
}

function buildTvSearchQueries(titles, season, seasonName, seasonYear, seriesYear) {
  var seen = {};
  var result = [];
  for (var i = 0; i < titles.length && result.length < 2; i++) {
    var key = normalizeQueryKey(titles[i]);
    if (seen[key]) continue;
    seen[key] = true;
    result.push(titles[i]);
  }
  if (seasonName && result.length < 4) {
    var sQuery = titles[0] + ' ' + seasonName;
    var sKey = normalizeQueryKey(sQuery);
    if (!seen[sKey]) { seen[sKey] = true; result.push(sQuery); }
  }
  var qYear = seasonYear != null ? seasonYear : seriesYear;
  if (qYear && result.length < 4) {
    var yQuery = titles[0] + ' ' + qYear;
    var yKey2 = normalizeQueryKey(yQuery);
    if (!seen[yKey2]) result.push(yQuery);
  }
  return result.slice(0, 4);
}

function resolveTmdbMetadata(input) {
  var cacheKey = input.mediaType + ':' + input.tmdbId + ':' + (input.season != null ? input.season : '-');
  var cached = tmdbCache.get(cacheKey);
  if (cached && Date.now() - cached.time < TMDB_CACHE_TTL) {
    return Promise.resolve(cached.value);
  }

  var id = String(input.tmdbId).trim();
  var type = input.mediaType;
  if (!/^\d+$/.test(id)) return Promise.reject(new Error('Invalid TMDB ID'));

  var typePath = type === 'movie' ? 'movie' : 'tv';
  return tmdbGet(typePath + '/' + encodeURIComponent(id), { language: 'zh-CN' })
    .then(function (detail) {
      var genres = (detail.genres || []).map(function (g) { return g.id; });
      var originCountry = detail.origin_country || [];

      if (type === 'movie') {
        return Promise.all([
          optionalTmdbGet('movie/' + encodeURIComponent(id) + '/alternative_titles', {}),
          optionalTmdbGet('movie/' + encodeURIComponent(id) + '/translations', {})
        ]).then(function (arr) {
          var extraTitles = extractExtraTitles(arr[0], arr[1]);
          var titles = uniqueValues([detail.title, detail.original_title].concat(extraTitles));
          if (titles.length === 0) throw new Error('TMDB movie has no usable title');
          var year = detail.release_date ? Number(detail.release_date.slice(0, 4)) : null;
          var result = {
            tmdbId: id, mediaType: 'movie', title: titles[0],
            originalTitle: detail.original_title || null,
            aliases: titles.slice(1), year: year,
            seriesYear: null, seasonYear: null, season: null,
            seasonLabels: [], expectedEpisodeCount: null,
            genres: genres, originCountry: originCountry,
            searchQueries: buildMovieSearchQueries(titles, year)
          };
          tmdbCache.set(cacheKey, { time: Date.now(), value: result });
          return result;
        });
      }

      return Promise.all([
        optionalTmdbGet('tv/' + encodeURIComponent(id) + '/alternative_titles', {}),
        optionalTmdbGet('tv/' + encodeURIComponent(id) + '/translations', {}),
        optionalTmdbGet(
          'tv/' + encodeURIComponent(id) + '/season/' + encodeURIComponent(input.season),
          { language: 'zh-CN' }
        )
      ]).then(function (arr) {
        var alt = arr[0], trans = arr[1], seasonDetail = arr[2];
        var extraTitles = extractExtraTitles(alt, trans);
        var titles = uniqueValues([detail.name, detail.original_name].concat(extraTitles));
        if (titles.length === 0) throw new Error('TMDB TV series has no usable title');
        var seriesYear = detail.first_air_date ? Number(detail.first_air_date.slice(0, 4)) : null;
        var seasonYear = (seasonDetail && seasonDetail.air_date) ? Number(seasonDetail.air_date.slice(0, 4)) : null;
        var expectedEpisodeCount = (seasonDetail && Array.isArray(seasonDetail.episodes)) ? seasonDetail.episodes.length : null;
        var result = {
          tmdbId: id, mediaType: 'tv', title: titles[0],
          originalTitle: detail.original_name || null,
          aliases: titles.slice(1), year: seasonYear != null ? seasonYear : seriesYear,
          seriesYear: seriesYear, seasonYear: seasonYear, season: input.season,
          seasonName: (seasonDetail && seasonDetail.name) || null,
          seasonLabels: uniqueValues([
            (seasonDetail && seasonDetail.name) || null,
            '第' + input.season + '季',
            '第' + chineseNumber(input.season) + '季',
            'Season ' + input.season
          ]),
          expectedEpisodeCount: expectedEpisodeCount,
          genres: genres, originCountry: originCountry,
          searchQueries: buildTvSearchQueries(
            titles, input.season,
            (seasonDetail && seasonDetail.name) || null,
            seasonYear, seriesYear
          )
        };
        tmdbCache.set(cacheKey, { time: Date.now(), value: result });
        return result;
      });
    });
}

// ==========================================
// 站点请求
// ==========================================
function fetchRsc(path) {
  var cached = rscCache.get(path);
  if (cached && Date.now() - cached.time < RSC_CACHE_TTL) {
    return Promise.resolve(cached.body);
  }
  return fetch(BASE_URL + path, {
    method: 'GET',
    headers: {
      Accept: '*/*', RSC: '1', 'Next-Url': path,
      Referer: BASE_URL + path,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
    }
  }).then(function (res) {
    return res.text().then(function (body) {
      if (!res.ok) throw new Error('RSC HTTP ' + res.status + ' @ ' + path);
      rscCache.set(path, { time: Date.now(), body: body });
      return body;
    });
  });
}

function searchVod(input, metadata) {
  var queries = Array.isArray(metadata.searchQueries) ? metadata.searchQueries : [];
  if (queries.length === 0) return Promise.resolve([]);

  return Promise.all(queries.map(function (query) {
    return fetchRsc('/vod/search/' + encodeURIComponent(query))
      .then(function (body) { return extractVodItems(body); })
      .catch(function () { return []; });
  })).then(function (results) {
    var items = [];
    var seen = new Set();
    for (var i = 0; i < results.length; i++) {
      var list = results[i];
      for (var j = 0; j < list.length; j++) {
        var key = String(list[j].vodId);
        if (!seen.has(key)) {
          seen.add(key);
          items.push(list[j]);
        }
      }
    }
    return items;
  });
}

function getDetail(vodId) {
  var path = '/detail/' + encodeURIComponent(String(vodId));
  return fetchRsc(path).then(function (body) {
    var detail = extractMeta(body);
    if (!detail) throw new Error('detail parsing failed for vodId=' + vodId);
    return detail;
  });
}

function selectEpisodes(detail, input, metadata) {
  var list = Array.isArray(detail.episodeList) ? detail.episodeList : [];
  if (input.mediaType === 'movie') return list;

  if (metadata && metadata.episodeNid != null) return [{ nid: metadata.episodeNid }];
  var wanted = String(input.episode);
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].name).trim() === wanted) return [list[i]];
  }
  for (var j = 0; j < list.length; j++) {
    if (Number(list[j].sort) === input.episode) return [list[j]];
  }
  if (list[input.episode - 1]) return [list[input.episode - 1]];
  return [];
}

function fetchEpisodeStreams(vodId, nid) {
  var params = { clientType: CLIENT_TYPE, id: String(vodId), nid: String(nid) };
  var t = Date.now();
  var sign = genSign({ method: 'GET', params: params, t: t });
  var queryParts = [];
  var keys = Object.keys(params);
  for (var i = 0; i < keys.length; i++) {
    queryParts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(params[keys[i]]));
  }
  var path = '/api/mw-movie/anonymous/v2/video/episode/url?' + queryParts.join('&');
  return fetch(BASE_URL + path, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'client-type': String(CLIENT_TYPE),
      // deviceId: DEVICE_ID,
      deviceId: getUUID(),
      sign: sign,
      t: String(t),
      authorization: '',
      Referer: BASE_URL + '/vod/play/' + vodId + '/sid/' + nid
    }
  }).then(function (res) {
    return res.text().then(function (body) {
      if (!res.ok) throw new Error('stream HTTP ' + res.status + ' nid=' + nid);
      var json;
      try { json = JSON.parse(body); } catch (e) { throw new Error('stream non-JSON nid=' + nid); }
      if (!json || json.code !== 200) throw new Error('stream API error: ' + (json && json.msg ? json.msg : 'unknown') + ' nid=' + nid);
      var list = (json.data && Array.isArray(json.data.list)) ? json.data.list : [];
      return list;
    });
  });
}

/**
 * 格式化 stream.name 字段，与 jpyy Stremio Addon 保持一致
 *   - movie:  {影片名称} [ {完整ID} ]
 *   - series: {影片名称} [ {完整ID} · SxxExx ]
 */
function formatStreamName(movieName, fullId, routeType, season, episode) {
  if (routeType === 'movie') {
    return movieName + ' [ ' + fullId + ' ]';
  }
  var ss = String(season != null ? season : 1).padStart(2, '0');
  var ee = String(episode != null ? episode : 1).padStart(2, '0');
  return movieName + ' [ ' + fullId + ' · S' + ss + 'E' + ee + ' ]';
}

function toStream(item, ctx) {
  if (!item || !item.url) return null;
  var rawUrl = String(item.url).trim();
  if (rawUrl.indexOf('http') !== 0) return null;
  var resolution = Number(item.resolution);
  var quality = Number.isFinite(resolution) ? Math.round(resolution) + 'p' : 'unknown';
  var resolutionName = String(item.resolutionName || '').trim();
  var title = resolutionName ? resolutionName + ' ' + quality : 'JPYY ' + quality;
  var baseName = ctx.vodName || PROVIDER_NAME;
  var displayName = formatStreamName(baseName, ctx.fullId, ctx.routeType, ctx.season, ctx.episode);
  return {
    name: displayName,
    title: title,
    url: rawUrl,
    quality: quality
  };
}

function scoreVod(item, metadata) {
  var candidates = uniqueValues(
    [metadata.title, metadata.originalTitle].concat(Array.isArray(metadata.aliases) ? metadata.aliases : [])
  );
  if (candidates.length === 0) return 0;
  var maxSim = 0;
  for (var i = 0; i < candidates.length; i++) {
    if (quickReject(candidates[i], item.vodName)) continue;
    var sim = similarity(candidates[i], item.vodName);
    if (sim > maxSim) maxSim = sim;
    if (maxSim >= 0.95) break;
  }
  if (maxSim < 0.3) return 0;
  var score = maxSim;
  var rawYear = String(item.vodYear || '').trim();
  var itemYear = Number.parseInt(rawYear.slice(0, 4), 10);
  if (Number.isFinite(itemYear)) {
    var expected = [metadata.seasonYear, metadata.year, metadata.seriesYear].filter(function (v) { return Number.isInteger(v); });
    var hit = false;
    for (var j = 0; j < expected.length; j++) {
      if (expected[j] === itemYear) { score += 0.3; hit = true; break; }
      if (Math.abs(expected[j] - itemYear) <= 1) { score += 0.15; hit = true; break; }
    }
    if (!hit && expected.length > 0) {
      var allFar = true;
      for (var k = 0; k < expected.length; k++) {
        if (Math.abs(expected[k] - itemYear) <= 3) { allFar = false; break; }
      }
      if (allFar) score -= 0.3;
    }
  }
  for (var m = 0; m < candidates.length; m++) {
    if (item.vodName === candidates[m]) { score += 0.5; break; }
    if (item.vodName.indexOf(candidates[m]) !== -1 || candidates[m].indexOf(item.vodName) !== -1) {
      score += 0.2;
      break;
    }
  }
  if (hasSeasonMarker(item, metadata)) score += 0.3;
  return score;
}

function getPreferredTypeIds(input, metadata) {
  if (input.mediaType === 'movie') return [1];
  var genres = Array.isArray(metadata.genres) ? metadata.genres : [];
  var isAnime = genres.indexOf(16) !== -1;
  var isVariety = genres.indexOf(10764) !== -1 || genres.indexOf(10767) !== -1;
  if (isAnime) return [4, 2, 88, 3];
  if (isVariety) return [3, 2, 88, 4];
  return [2, 3, 4, 88];
}

function pickVod(items, input, metadata) {
  var tmdbYears = [metadata.seasonYear, metadata.year, metadata.seriesYear].filter(function (v) { return Number.isInteger(v); });
  var tmdbYear = tmdbYears.length > 0 ? tmdbYears[0] : null;
  var preferredIds = getPreferredTypeIds(input, metadata);

  for (var p = 0; p < preferredIds.length; p++) {
    var targetId = preferredIds[p];
    var candidates = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (Number(item.typeId1) !== targetId) continue;
      if (input.mediaType === 'tv' && hasWrongSeasonMark(item.vodName, input.season)) continue;
      if (tmdbYear != null && item.vodYear) {
        var itemYear = Number.parseInt(String(item.vodYear).slice(0, 4), 10);
        if (Number.isFinite(itemYear) && Math.abs(itemYear - tmdbYear) > 2) continue;
      }
      candidates.push(item);
    }

    var ranked = [];
    for (var j = 0; j < candidates.length; j++) {
      var s = scoreVod(candidates[j], metadata);
      if (s >= MIN_VOD_SCORE) ranked.push({ item: candidates[j], score: s });
    }
    ranked.sort(function (a, b) { return b.score - a.score; });
    if (ranked.length > 0) return ranked[0].item;
  }
  return null;
}

// ==========================================
// 🚀 新增：站内 ID 直接获取流, 对应 jpyy_strmeio addon 使用jp ID的插件
// ==========================================
function getStreamsByVodId(vodId, mediaType, season, episode) {
  var input = {
    tmdbId: String(vodId),
    mediaType: mediaType,
    season: season != null ? Number(season) : null,
    episode: episode != null ? Number(episode) : null
  };
  var vodName = '';
  return getDetail(vodId)
    .then(function (detail) {
      vodName = detail.vodName || detail.name || '';
      // 🚀 根据 detail.typeId1 修正媒体类型，避免电影被误判为剧集
      if (detail.typeId1 === 1) {
        input.mediaType = 'movie';
      }
      var episodes = selectEpisodes(detail, input, {});
      if (episodes.length === 0) throw new Error('no episode matched for ep ' + input.episode);
      var validEps = episodes.filter(function (ep) { return ep.nid != null; });
      return Promise.all(validEps.map(function (ep) {
        return fetchEpisodeStreams(vodId, ep.nid)
          .then(function (items) {
            return items.map(function (item) {
              return toStream(item, {
                vodName: vodName,
                fullId: 'jp' + vodId,
                routeType: input.mediaType,
                season: input.season,
                episode: input.episode
              });
            }).filter(Boolean);
          });
      }));
    })
    .then(function (results) {
      var streams = [];
      var seen = new Set();
      for (var i = 0; i < results.length; i++) {
        for (var j = 0; j < results[i].length; j++) {
          var s = results[i][j];
          if (s && !seen.has(s.url)) {
            seen.add(s.url);
            streams.push(s);
          }
        }
      }
      if (streams.length === 0) throw new Error('no streams returned');
      return streams;
    });
}

// ==========================================
// 主入口
// ==========================================
function getStreams(tmdbId, mediaType, season, episode) {
  var step = 'init';
  var rawId = String(tmdbId || '').trim();

  // 🚀 分支 1：站内 ID（jp 前缀）直接处理
  if (/^jp\d+$/i.test(rawId)) {
    var vodId = rawId.replace(/^jp/i, '');
    var mediaTypeLower = String(mediaType || '').trim().toLowerCase();
    return getStreamsByVodId(vodId, mediaTypeLower, season, episode)
      .catch(function (err) {
        var debugInfo = 'JPID[' + rawId + '|' + mediaType + '|' + season + '|' + episode + '][' + err.message + ']';
        return [{
          name: PROVIDER_NAME,
          title: 'ERROR',
          url: 'https://jpyy.debug/?msg=' + debugInfo,
          quality: 'ERROR, 长按获取错误详情'
        }];
      });
  }

  // 🚀 分支 2：TMDB ID，走原有流程
  var input = {
    tmdbId: rawId,
    mediaType: String(mediaType || '').trim().toLowerCase(),
    season: season != null ? Number(season) : null,
    episode: episode != null ? Number(episode) : null
  };

  return Promise.resolve()
    .then(function () {
      if (!input.tmdbId) throw new Error('tmdbId is required');
      if (input.mediaType !== 'movie' && input.mediaType !== 'tv') throw new Error('mediaType must be movie or tv');
      step = 'resolveTmdbMetadata';
      return resolveTmdbMetadata(input);
    })
    .then(function (metadata) {
      if (!metadata || !metadata.title) throw new Error('TMDB metadata incomplete');
      step = 'searchVod';
      return searchVod(input, metadata).then(function (items) {
        return { metadata: metadata, items: items };
      });
    })
    .then(function (ctx) {
      step = 'pickVod';
      var vod = pickVod(ctx.items, input, ctx.metadata);
      if (!vod) return [];
      step = 'getDetail';
      return getDetail(vod.vodId).then(function (detail) {
        // 🚀 根据 detail.typeId1 修正媒体类型
        if (detail.typeId1 === 1) {
          input.mediaType = 'movie';
        }

        return { metadata: ctx.metadata, vod: vod, detail: detail };
      });
    })
    .then(function (result) {
      if (Array.isArray(result)) return result;
      step = 'selectEpisodes';
      var metadata = result.metadata;
      var vod = result.vod;
      var detail = result.detail;
      var vodName = detail.vodName || detail.name || metadata.title || '';
      var episodes = selectEpisodes(detail, input, metadata);
      if (episodes.length === 0) throw new Error('no episode matched for ep ' + input.episode);

      step = 'fetchEpisodeStreams';
      var validEps = episodes.filter(function (ep) { return ep.nid != null; });
      return Promise.all(validEps.map(function (ep) {
        return fetchEpisodeStreams(vod.vodId, ep.nid)
          .then(function (items) {
            return items.map(function (item) {
              return toStream(item, {
                vodName: vodName,
                fullId: rawId,
                routeType: input.mediaType,
                season: input.season,
                episode: input.episode
              });
            }).filter(Boolean);
          });
      })).then(function (results) {
        var streams = [];
        var seen = new Set();
        for (var i = 0; i < results.length; i++) {
          for (var j = 0; j < results[i].length; j++) {
            var s = results[i][j];
            if (s && !seen.has(s.url)) {
              seen.add(s.url);
              streams.push(s);
            }
          }
        }
        if (streams.length === 0) throw new Error('no streams returned');
        return streams;
      });
    })
    .catch(function (err) {
      // 🚀 调试信息写入 url，便于长按复制
      var rawInfo = 'RAW[' + rawId + '|' + String(mediaType) + '|' + String(season) + '|' + String(episode) + ']';
      var debugInfo = rawInfo + '[' + step + '] ' + err.message;
      return [{
        name: PROVIDER_NAME,
        title: 'ERROR',
        url: 'https://jpyy.debug/?msg=' + debugInfo,
        quality: 'ERROR, 长按获取错误详情'
      }];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
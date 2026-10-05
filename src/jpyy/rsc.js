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
    } catch {
      // 某些 Next.js RSC 记录不是完整 JSON，后续可以单独扩展。
    }

    current = null;
  }

  for (const line of String(body).split(/\r?\n/)) {
    const match = line.match(/^([0-9a-f]+):\s?(.*)$/i);

    if (match) {
      flush();

      current = {
        raw: match[2],
      };
    } else if (current) {
      current.raw += `\n${line}`;
    }
  }

  flush();

  if (values.length === 0) {
    try {
      values.push(JSON.parse(body));
    } catch {
      // 保留为空，由调用方决定如何处理。
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
  return (
    value &&
    typeof value === "object" &&
    value.vodId !== undefined &&
    value.vodId !== null
  );
}

export function extractVodItems(body) {
  const records = parseRscRecords(body);
  const result = [];
  const seen = new Set();

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

export function extractMeta(body) {
  const records = parseRscRecords(body);

  for (const record of records) {
    let matched = null;

    walk(record, (node) => {
      if (
        !matched &&
        node &&
        node.vodId !== undefined &&
        node.vodId !== null &&
        Array.isArray(node.episodeList)
      ) {
        matched = node;
      }
    });

    if (matched) {
      return matched;
    }
  }

  return null;
}
// src/jpyy/sign.js

import CryptoJS from "crypto-js";

export const SIGN_KEY = "cb808529bae6b6be45ecfab29a4889bc";

export function genSign({
  method = "GET",
  params = {},
  t = Date.now(),
  signKey = SIGN_KEY,
} = {}) {
  const upperMethod = String(method).toUpperCase();

  let payload = "";

  if (upperMethod === "GET") {
    const keys = Object.keys(params).sort();

    payload = keys.length
      ? keys.map((key) => `${key}=${params[key]}`).join("&")
      : "";
  } else {
    payload = Object.keys(params).length
      ? JSON.stringify(params)
      : "";
  }

  const input = payload
    ? `${payload}&key=${signKey}&t=${t}`
    : `key=${signKey}&t=${t}`;

  const md5 = CryptoJS.MD5(input).toString();

  return CryptoJS.SHA1(md5).toString();
}
export const apiHost = import.meta.env.DEV ? 'localhost:8188' : location.host
export const apiProtocol = location.protocol
export const apiBase = import.meta.env.DEV
  ? 'http://localhost:8188'
  : location.origin

export function apiPath(path: string) {
  return import.meta.env.DEV
    ? `${apiProtocol}//${apiHost}${path}`
    : `${apiBase}${path}`
}

export function fetchApi(path: string, options: RequestInit = {}) {
  return fetch(apiPath(path), options)
}

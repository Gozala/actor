export const SUSPEND = null
export const YIELD = undefined
export const UNIT = Object.freeze({})
export const CONTINUE = Object.freeze({ continue: UNIT })
export const Yield = Object.freeze({ done: false, value: YIELD })
export const Suspend = Object.freeze({ done: false, value: SUSPEND })
export const OK = Object.freeze({ ok: UNIT })

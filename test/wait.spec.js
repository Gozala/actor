import * as Task from "../src/scratch.js"
import { assert, createLog, inspect } from "./util.js"

describe("wait", () => {
  it("it does wait on non-promise", async () => {
    let isSync = true
    function* worker() {
      const message = yield* Task.wait(5)
      assert.equal(isSync, true, "expect to be sync")
      assert.equal(message, 5)
    }

    const result = Task.fork(inspect(worker())).then()
    isSync = false
    assert.deepEqual(await result, {
      ok: true,
      value: undefined,
      mail: [],
    })
  })

  it("does await on promise", async () => {
    let isSync = true
    function* main() {
      const message = yield* Task.wait(Promise.resolve(5))
      assert.equal(isSync, false, "expect to be async")
      assert.equal(message, 5)
    }
    const fork = Task.fork(inspect(main())).then()
    isSync = false

    assert.deepEqual(await fork, {
      ok: true,
      value: undefined,
      mail: [],
    })
  })

  it("lets you yield", async () => {
    function* main() {
      /** @type {unknown} */
      const value = yield 5
      assert.equal(value, undefined, "return undefined on normal yield")
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      value: undefined,
      ok: true,
      mail: [5],
    })
  })

  it("does throw on failed promise", async () => {
    const boom = new Error("boom!")
    function* main() {
      const message = yield* Task.wait(Promise.reject(boom))
      return message
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      mail: [],
      error: boom,
    })
  })

  it("can catch promise errors", async () => {
    const boom = new Error("boom!")
    function* main() {
      try {
        const message = yield* Task.wait(Promise.reject(boom))
        return message
      } catch (error) {
        return error
      }
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      mail: [],
      value: boom,
    })
  })

  it("can intercept thrown errors", async () => {
    const boom = new Error("boom!")
    const fail = () => {
      throw boom
    }

    function* main() {
      fail()
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      mail: [],
      error: boom,
    })
  })

  it("can catch thrown errors", async () => {
    const boom = new Error("boom!")
    const fail = () => {
      throw boom
    }

    function* main() {
      try {
        fail()
      } catch (error) {
        return error
      }
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      mail: [],
      value: boom,
    })
  })

  it("use finally", async () => {
    const boom = new Error("boom!")
    let finalized = false
    function* main() {
      try {
        const message = yield* Task.wait(Promise.reject(boom))
        return message
      } finally {
        finalized = true
      }
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      mail: [],
      error: boom,
    })

    assert.equal(finalized, true)
  })
})

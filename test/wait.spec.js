import { Task } from "../src/lib.js"
import { wake } from "../src/scheduler.js"
import { assert, createLog, inspect } from "./util.js"

describe("wait", () => {
  it("does wait on non-promise", async () => {
    let complete = false
    function* worker() {
      const message = yield* Task.wait(5)
      assert.equal(message, 5)
      complete = true
    }

    const result = Task.fork(inspect(worker()))
    // we need to force wake scheduler to see the effect of the sync
    wake()
    assert.equal(complete, true, "expect to be complete")

    assert.deepEqual(await result, {
      ok: true,
      value: undefined,
      mail: [],
    })
  })

  it("interleaves with other tasks", async () => {
    const { log, output } = createLog()
    function* wait() {
      log("start wait")
      const message = yield* Task.wait(5)
      log("end wait")
      assert.equal(message, 5)
    }

    function* work() {
      log("start work")
      yield* Task.sleep(1)
      log("end work")
    }

    const waited = Task.fork(wait())
    const worked = Task.fork(work())

    assert.deepEqual(await waited, undefined)
    assert.deepEqual(await worked, undefined)

    assert.deepEqual(output, [
      "start wait",
      "start work",
      "end wait",
      "end work",
    ])
  })

  it("does wait on promise", async () => {
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

    assert.deepEqual(await Task.fork(main()).catch(e => e), boom)
  })

  it("can intercept thrown errors", async () => {
    const boom = new Error("boom!")
    const fail = () => {
      throw boom
    }

    function* main() {
      fail()
    }

    assert.deepEqual(await Task.fork(main()).catch(error => error), boom)
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
        return { caught: error }
      }
    }

    assert.deepEqual(await Task.fork(main()), {
      caught: boom,
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

    assert.deepEqual(await Task.fork(main()).catch(e => e), boom)

    assert.equal(finalized, true)
  })
})
